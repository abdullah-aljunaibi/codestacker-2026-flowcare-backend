import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, roleMiddleware, ownershipMiddleware } from '../middleware/auth.js';
import { createAppointmentSchema, updateAppointmentSchema } from '../types/index.js';
import { logAudit, getIpAddressFromRequest } from '../utils/audit-logger.js';

const router = Router();
const prisma = new PrismaClient();

// All appointment routes require authentication
router.use(authMiddleware);

// GET /api/appointments - List appointments
// ADMIN: all appointments
// BRANCH_MANAGER/STAFF: appointments at their branch
// CUSTOMER: their own appointments only
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, branchId, startDate, endDate } = req.query;
    
    let whereClause: any = {};
    
    // Role-based filtering
    if (req.user?.role === 'CUSTOMER') {
      // CUSTOMER can only see their own appointments
      if (!req.user?.customerId) {
        res.status(403).json({
          success: false,
          error: 'Customer profile not found',
        });
        return;
      }
      whereClause.customerId = req.user.customerId;
    } else if (req.user?.role === 'BRANCH_MANAGER' || req.user?.role === 'STAFF') {
      // BRANCH_MANAGER/STAFF can only see appointments at their branch
      if (req.user?.branchId) {
        whereClause.branchId = req.user.branchId;
      }
    }
    // ADMIN can see all appointments (no filter)
    
    // Additional filters
    if (status) {
      whereClause.status = status;
    }
    
    if (branchId && req.user?.role === 'ADMIN') {
      // Only ADMIN can filter by arbitrary branch
      whereClause.branchId = branchId;
    }
    
    if (startDate || endDate) {
      whereClause.slot = whereClause.slot || {};
      whereClause.slot.startTime = {};
      if (startDate) {
        whereClause.slot.startTime.gte = new Date(startDate as string);
      }
      if (endDate) {
        whereClause.slot.startTime.lte = new Date(endDate as string);
      }
    }
    
    const appointments = await prisma.appointment.findMany({
      where: whereClause,
      select: {
        id: true,
        status: true,
        notes: true,
        attachmentUrl: true,
        checkedInAt: true,
        startedAt: true,
        completedAt: true,
        cancelledAt: true,
        createdAt: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        customer: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        slot: {
          select: {
            id: true,
            startTime: true,
            endTime: true,
            serviceType: {
              select: {
                name: true,
                code: true,
                duration: true,
              },
            },
          },
        },
        staff: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json({
      success: true,
      data: appointments,
    });
  } catch (error) {
    console.error('Error listing appointments:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /api/appointments - Create appointment
// CUSTOMER: can book for themselves
// BRANCH_MANAGER/STAFF: can book for customers at their branch
// ADMIN: can book anywhere
router.post('/', async (req: Request, res: Response) => {
  try {
    const validation = createAppointmentSchema.safeParse(req.body);
    
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.errors,
      });
      return;
    }
    
    const data = validation.data;
    
    // Auto-fill customerId from JWT for CUSTOMER role
    if (req.user?.role === 'CUSTOMER' && !data.customerId) {
      data.customerId = req.user.customerId;
    }
    
    // Role-based access control
    if (req.user?.role === 'CUSTOMER') {
      // CUSTOMER can only book for themselves
      if (!req.user?.customerId) {
        res.status(403).json({
          success: false,
          error: 'Customer profile not found',
        });
        return;
      }
      if (data.customerId !== req.user.customerId) {
        res.status(403).json({
          success: false,
          error: 'Can only book appointments for yourself',
        });
        return;
      }
    } else if (req.user?.role === 'BRANCH_MANAGER' || req.user?.role === 'STAFF') {
      // BRANCH_MANAGER/STAFF can only book at their branch
      if (req.user?.branchId && data.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Can only book appointments at your assigned branch',
        });
        return;
      }
    }
    // ADMIN can book anywhere (no restrictions)
    
    // Check if slot exists and has capacity
    const slot = await prisma.slot.findUnique({
      where: { id: data.slotId },
      select: {
        id: true,
        capacity: true,
        bookedCount: true,
        isActive: true,
        branchId: true,
        serviceTypeId: true,
        startTime: true,
        endTime: true,
      },
    });
    
    if (!slot) {
      res.status(404).json({
        success: false,
        error: 'Time slot not found',
      });
      return;
    }
    
    if (!slot.isActive) {
      res.status(400).json({
        success: false,
        error: 'This time slot is no longer available',
      });
      return;
    }
    
    if (slot.bookedCount >= slot.capacity) {
      res.status(400).json({
        success: false,
        error: 'Time slot is fully booked',
      });
      return;
    }
    
    // Verify service type matches slot
    if (data.serviceTypeId !== slot.serviceTypeId) {
      res.status(400).json({
        success: false,
        error: 'Service type does not match the selected time slot',
      });
      return;
    }
    
    // Create appointment with transaction
    const appointment = await prisma.$transaction(async (tx) => {
      // Increment booked count
      await tx.slot.update({
        where: { id: data.slotId },
        data: { bookedCount: slot.bookedCount + 1 },
      });
      
      // Create appointment
      return tx.appointment.create({
        data: {
          branchId: data.branchId,
          customerId: data.customerId,
          slotId: data.slotId,
          staffId: data.staffId,
          serviceTypeId: data.serviceTypeId,
          notes: data.notes,
          attachmentUrl: data.attachmentUrl,
          status: 'SCHEDULED',
        },
        select: {
          id: true,
          status: true,
          notes: true,
          attachmentUrl: true,
          createdAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          customer: {
            select: {
              id: true,
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          slot: {
            select: {
              id: true,
              startTime: true,
              endTime: true,
              serviceType: {
                select: {
                  name: true,
                  code: true,
                },
              },
            },
          },
        },
      });
    });
    
    // Audit log: appointment created
    await logAudit(
      req.user?.userId,
      'APPOINTMENT_CREATED',
      'Appointment',
      appointment.id,
      {
        branchId: data.branchId,
        customerId: data.customerId,
        slotId: data.slotId,
        serviceTypeId: data.serviceTypeId,
        status: 'SCHEDULED',
      },
      getIpAddressFromRequest(req)
    );
    
    res.status(201).json({
      success: true,
      data: appointment,
      message: 'Appointment booked successfully',
    });
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /api/appointments/:id - Get appointment details
router.get('/:id',
  ownershipMiddleware('appointment', 'id'),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      
      const appointment = await prisma.appointment.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          notes: true,
          attachmentUrl: true,
          checkedInAt: true,
          startedAt: true,
          completedAt: true,
          cancelledAt: true,
          cancelReason: true,
          createdAt: true,
          updatedAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
              address: true,
              city: true,
              phone: true,
            },
          },
          customer: {
            select: {
              id: true,
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
          slot: {
            select: {
              id: true,
              startTime: true,
              endTime: true,
              serviceType: {
                select: {
                  name: true,
                  code: true,
                  duration: true,
                  description: true,
                },
              },
            },
          },
          staff: {
            select: {
              id: true,
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
              position: true,
            },
          },
        },
      });
      
      if (!appointment) {
        res.status(404).json({
          success: false,
          error: 'Appointment not found',
        });
        return;
      }
      
      res.json({
        success: true,
        data: appointment,
      });
    } catch (error) {
      console.error('Error getting appointment:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// PATCH /api/appointments/:id - Update appointment
// Supports: status updates, check-in, cancellation
router.patch('/:id',
  ownershipMiddleware('appointment', 'id'),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const validation = updateAppointmentSchema.safeParse(req.body);
      
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }
      
      const updateData = validation.data;
      
      // Get current appointment
      const appointment = await prisma.appointment.findUnique({
        where: { id },
        select: { status: true, slotId: true },
      });
      
      if (!appointment) {
        res.status(404).json({
          success: false,
          error: 'Appointment not found',
        });
        return;
      }
      
      // Build update data separately to handle timestamps properly
      const prismaUpdateData: any = { ...updateData };
      
      // Handle cancellation - decrement slot count
      if (updateData.status === 'CANCELLED' && appointment.status !== 'CANCELLED') {
        await prisma.slot.update({
          where: { id: appointment.slotId },
          data: { bookedCount: { decrement: 1 } },
        });
        
        // Set cancellation timestamp
        prismaUpdateData.cancelledAt = new Date();
      }
      
      // Handle check-in
      if (updateData.status === 'CHECKED_IN' && appointment.status === 'SCHEDULED') {
        prismaUpdateData.checkedInAt = new Date();
      }
      
      // Handle start service
      if (updateData.status === 'IN_PROGRESS' && appointment.status === 'CHECKED_IN') {
        prismaUpdateData.startedAt = new Date();
      }
      
      // Handle completion
      if (updateData.status === 'COMPLETED' && appointment.status === 'IN_PROGRESS') {
        prismaUpdateData.completedAt = new Date();
      }
      
      const updatedAppointment = await prisma.appointment.update({
        where: { id },
        data: prismaUpdateData,
        select: {
          id: true,
          status: true,
          notes: true,
          attachmentUrl: true,
          checkedInAt: true,
          startedAt: true,
          completedAt: true,
          cancelledAt: true,
          updatedAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          customer: {
            select: {
              id: true,
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          slot: {
            select: {
              id: true,
              startTime: true,
              endTime: true,
            },
          },
        },
      });
      
      // Audit log: appointment status changed
      if (updateData.status && updateData.status !== appointment.status) {
        let auditAction: any = 'APPOINTMENT_STATUS_CHANGED';
        
        // Use more specific action types for key transitions
        if (updateData.status === 'CANCELLED' && appointment.status !== 'CANCELLED') {
          auditAction = 'APPOINTMENT_CANCELLED';
        }
        
        await logAudit(
          req.user?.userId,
          auditAction,
          'Appointment',
          id,
          {
            previousStatus: appointment.status,
            newStatus: updateData.status,
            branchId: updatedAppointment.branch.id,
          },
          getIpAddressFromRequest(req)
        );
      }
      
      res.json({
        success: true,
        data: updatedAppointment,
        message: 'Appointment updated successfully',
      });
    } catch (error: any) {
      console.error('Error updating appointment:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Appointment not found',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  }
);

// DELETE /api/appointments/:id - Cancel/delete appointment
router.delete('/:id',
  ownershipMiddleware('appointment', 'id'),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      
      const appointment = await prisma.appointment.findUnique({
        where: { id },
        select: { status: true, slotId: true },
      });
      
      if (!appointment) {
        res.status(404).json({
          success: false,
          error: 'Appointment not found',
        });
        return;
      }
      
      // Cannot delete completed appointments
      if (appointment.status === 'COMPLETED') {
        res.status(400).json({
          success: false,
          error: 'Cannot delete completed appointments',
        });
        return;
      }
      
      // If not already cancelled, decrement slot count
      if (appointment.status !== 'CANCELLED') {
        await prisma.slot.update({
          where: { id: appointment.slotId },
          data: { bookedCount: { decrement: 1 } },
        });
      }
      
      await prisma.appointment.delete({
        where: { id },
      });
      
      // Audit log: appointment cancelled (via delete)
      await logAudit(
        req.user?.userId,
        'APPOINTMENT_CANCELLED',
        'Appointment',
        id,
        {
          previousStatus: appointment.status,
          slotId: appointment.slotId,
        },
        getIpAddressFromRequest(req)
      );
      
      res.json({
        success: true,
        message: 'Appointment cancelled successfully',
      });
    } catch (error: any) {
      console.error('Error deleting appointment:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Appointment not found',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  }
);

export default router;
