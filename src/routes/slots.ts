import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, roleMiddleware, branchScopedMiddleware } from '../middleware/auth.js';
import { createSlotSchema, updateSlotSchema } from '../types/index.js';
import { logAudit, getIpAddressFromRequest } from '../utils/audit-logger.js';

const router = Router();
const prisma = new PrismaClient();

// All slot routes require authentication

// GET /api/slots - List available slots
// ADMIN: all slots (can use includeDeleted=true to see soft-deleted)
// BRANCH_MANAGER/STAFF: slots in their branch (excludes soft-deleted)
// CUSTOMER: active slots with available capacity (for booking, excludes soft-deleted)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { branchId, serviceTypeId, startDate, endDate, isActive, available, includeDeleted } = req.query;
    
    let whereClause: any = {};
    
    // Filter by branch
    if (branchId) {
      whereClause.branchId = branchId as string;
    } else if (req.user?.role === 'BRANCH_MANAGER' || req.user?.role === 'STAFF') {
      // Auto-filter to user's branch for non-ADMIN
      if (req.user?.branchId) {
        whereClause.branchId = req.user.branchId;
      }
    }
    
    // Filter by service type
    if (serviceTypeId) {
      whereClause.serviceTypeId = serviceTypeId as string;
    }
    
    // Filter by active status
    if (isActive !== undefined) {
      whereClause.isActive = isActive === 'true';
    }
    
    // Filter by date range
    if (startDate || endDate) {
      whereClause.startTime = {};
      if (startDate) {
        whereClause.startTime.gte = new Date(startDate as string);
      }
      if (endDate) {
        whereClause.startTime.lte = new Date(endDate as string);
      }
    }
    
    // Exclude soft-deleted slots by default (unless admin requests includeDeleted)
    const canViewDeleted = req.user?.role === 'ADMIN' && includeDeleted === 'true';
    if (!canViewDeleted) {
      whereClause.deletedAt = null;
    }
    
    // Filter by availability (for CUSTOMER role)
    if (available === 'true' || req.user?.role === 'CUSTOMER') {
      whereClause.bookedCount = { lt: prisma.slot.fields.capacity };
      whereClause.isActive = true;
    }
    
    const slots = await prisma.slot.findMany({
      where: whereClause,
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        bookedCount: true,
        isActive: true,
        deletedAt: true,
        createdAt: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        serviceType: {
          select: {
            id: true,
            name: true,
            code: true,
            duration: true,
          },
        },
        _count: {
          select: {
            assignments: true,
            appointments: true,
          },
        },
      },
      orderBy: { startTime: 'asc' },
      take: 100,
    });
    
    res.json({
      success: true,
      data: slots,
    });
  } catch (error) {
    console.error('Error listing slots:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /api/slots - Create time slot (ADMIN/BRANCH_MANAGER)
router.post('/', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const validation = createSlotSchema.safeParse(req.body);
      
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }
      
      const data = validation.data;
      
      // BRANCH_MANAGER can only create slots in their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && req.user?.branchId !== data.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only create slots in your assigned branch',
        });
        return;
      }
      
      // Validate that service type exists and belongs to the branch
      const serviceType = await prisma.serviceType.findUnique({
        where: { id: data.serviceTypeId },
        select: { id: true, branchId: true },
      });
      
      if (!serviceType) {
        res.status(400).json({
          success: false,
          error: 'Service type not found',
        });
        return;
      }
      
      if (serviceType.branchId !== data.branchId) {
        res.status(400).json({
          success: false,
          error: 'Service type does not belong to the specified branch',
        });
        return;
      }
      
      // Validate time range
      const startTime = new Date(data.startTime);
      const endTime = new Date(data.endTime);
      
      if (endTime <= startTime) {
        res.status(400).json({
          success: false,
          error: 'End time must be after start time',
        });
        return;
      }
      
      const slot = await prisma.slot.create({
        data: {
          branchId: data.branchId,
          serviceTypeId: data.serviceTypeId,
          startTime,
          endTime,
          capacity: data.capacity,
        },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          capacity: true,
          bookedCount: true,
          isActive: true,
          createdAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          serviceType: {
            select: {
              id: true,
              name: true,
              code: true,
              duration: true,
            },
          },
        },
      });
      
      // Audit log: slot created
      await logAudit(
        req.user?.userId,
        'SLOT_CREATED',
        'Slot',
        slot.id,
        {
          branchId: data.branchId,
          serviceTypeId: data.serviceTypeId,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          capacity: data.capacity,
        },
        getIpAddressFromRequest(req)
      );
      
      res.status(201).json({
        success: true,
        data: slot,
        message: 'Time slot created successfully',
      });
    } catch (error) {
      console.error('Error creating slot:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// POST /api/slots/cleanup-retention - Permanently delete soft-deleted slots exceeding retention period (ADMIN only)
// Retention period: specified in days via query param (default: 30 days)
// Only deletes slots where deletedAt is older than the retention period
router.post('/cleanup-retention', authMiddleware,
  roleMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      // Retention period in days (default: 30 days)
      const retentionDays = req.query.days ? parseInt(req.query.days as string, 10) : 30;
      
      if (isNaN(retentionDays) || retentionDays < 1) {
        res.status(400).json({
          success: false,
          error: 'Invalid retention period. Must be a positive number of days.',
        });
        return;
      }
      
      // Calculate cutoff date: slots deleted before this date will be permanently deleted
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      
      // Find soft-deleted slots that exceed the retention period
      const slotsToDelete = await prisma.slot.findMany({
        where: {
          deletedAt: {
            lte: cutoffDate,
          },
        },
        select: {
          id: true,
          branchId: true,
          serviceTypeId: true,
          startTime: true,
          endTime: true,
          deletedAt: true,
          createdAt: true,
        },
        take: 1000, // Safety limit to prevent mass deletion accidents
      });
      
      const slotIdsToDelete = slotsToDelete.map(slot => slot.id);
      
      // If no slots to delete, return early
      if (slotIdsToDelete.length === 0) {
        res.json({
          success: true,
          message: `No soft-deleted slots found exceeding ${retentionDays} day retention period`,
          data: {
            retentionDays,
            cutoffDate: cutoffDate.toISOString(),
            deletedCount: 0,
            deletedSlots: [],
          },
        });
        return;
      }
      
      // Log what we're about to delete (for audit trail)
      const deletionDetails = slotsToDelete.map(slot => ({
        id: slot.id,
        branchId: slot.branchId,
        serviceTypeId: slot.serviceTypeId,
        startTime: slot.startTime.toISOString(),
        deletedAt: slot.deletedAt!.toISOString(),
      }));
      
      // Permanently delete the slots
      await prisma.slot.deleteMany({
        where: {
          id: {
            in: slotIdsToDelete,
          },
        },
      });
      
      // Audit log: retention cleanup performed
      await logAudit(
        req.user?.userId,
        'RETENTION_CLEANUP',
        'Slot',
        undefined,
        {
          action: 'PERMANENT_DELETE_SOFT_DELETED_SLOTS',
          retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          deletedCount: slotIdsToDelete.length,
          deletedSlots: deletionDetails,
        },
        getIpAddressFromRequest(req)
      );
      
      res.json({
        success: true,
        message: `Permanently deleted ${slotIdsToDelete.length} soft-deleted slot(s) exceeding ${retentionDays} day retention period`,
        data: {
          retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          deletedCount: slotIdsToDelete.length,
          deletedSlots: deletionDetails,
        },
      });
    } catch (error: any) {
      console.error('Error performing retention cleanup:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error during retention cleanup',
      });
    }
  }
);

// GET /api/slots/retention-preview - Preview which soft-deleted slots would be deleted (ADMIN only)
// Returns slots that would be deleted without actually deleting them
// Useful for testing/verification before running actual cleanup
router.get('/retention-preview', authMiddleware,
  roleMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      // Retention period in days (default: 30 days)
      const retentionDays = req.query.days ? parseInt(req.query.days as string, 10) : 30;
      
      if (isNaN(retentionDays) || retentionDays < 1) {
        res.status(400).json({
          success: false,
          error: 'Invalid retention period. Must be a positive number of days.',
        });
        return;
      }
      
      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      
      // Find soft-deleted slots that exceed the retention period
      const slotsToBeDeleted = await prisma.slot.findMany({
        where: {
          deletedAt: {
            lte: cutoffDate,
          },
        },
        select: {
          id: true,
          branchId: true,
          serviceTypeId: true,
          startTime: true,
          endTime: true,
          capacity: true,
          deletedAt: true,
          createdAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          serviceType: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
        take: 100,
        orderBy: { deletedAt: 'asc' },
      });
      
      res.json({
        success: true,
        message: `Found ${slotsToBeDeleted.length} soft-deleted slot(s) exceeding ${retentionDays} day retention period`,
        data: {
          retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          wouldDeleteCount: slotsToBeDeleted.length,
          slotsToBeDeleted,
        },
      });
    } catch (error: any) {
      console.error('Error previewing retention cleanup:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error during retention preview',
      });
    }
  }
);

// GET /api/slots/:id - Get slot details
// Excludes soft-deleted slots by default. ADMIN can use ?includeDeleted=true to view deleted slots.
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { includeDeleted } = req.query;
    
    // Check if user can view soft-deleted slots (ADMIN only)
    const canViewDeleted = req.user?.role === 'ADMIN' && includeDeleted === 'true';
    
    // Build where clause to exclude soft-deleted unless admin requests them
    const whereClause: any = { id };
    if (!canViewDeleted) {
      whereClause.deletedAt = null;
    }
    
    const slot = await prisma.slot.findFirst({
      where: whereClause,
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        bookedCount: true,
        isActive: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            address: true,
            city: true,
          },
        },
        serviceType: {
          select: {
            id: true,
            name: true,
            code: true,
            duration: true,
            description: true,
          },
        },
        assignments: {
          select: {
            id: true,
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
        },
        appointments: {
          select: {
            id: true,
            status: true,
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
          },
          take: 20,
        },
        _count: {
          select: {
            assignments: true,
            appointments: true,
          },
        },
      },
    });
    
    if (!slot) {
      res.status(404).json({
        success: false,
        error: 'Time slot not found',
      });
      return;
    }
    
    // Check access: BRANCH_MANAGER/STAFF can only view slots in their branch
    if (req.user?.role === 'BRANCH_MANAGER' || req.user?.role === 'STAFF') {
      if (req.user?.branchId && slot.branch.id !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Cannot view slots outside your branch',
        });
        return;
      }
    }
    
    res.json({
      success: true,
      data: slot,
    });
  } catch (error) {
    console.error('Error getting slot:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// PATCH /api/slots/:id - Update slot (ADMIN/BRANCH_MANAGER)
router.patch('/:id', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const validation = updateSlotSchema.safeParse(req.body);
      
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }
      
      const existingSlot = await prisma.slot.findUnique({
        where: { id },
        select: { branchId: true, bookedCount: true, capacity: true },
      });
      
      if (!existingSlot) {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
        });
        return;
      }
      
      // BRANCH_MANAGER can only update slots in their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && existingSlot.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only update slots in your assigned branch',
        });
        return;
      }
      
      const updateData = validation.data;
      
      // Validate capacity if being updated
      if (updateData.capacity !== undefined) {
        if (updateData.capacity < existingSlot.bookedCount) {
          res.status(400).json({
            success: false,
            error: `Cannot reduce capacity below current bookings (${existingSlot.bookedCount})`,
          });
          return;
        }
      }
      
      // Validate service type if being updated
      if (updateData.serviceTypeId) {
        const serviceType = await prisma.serviceType.findUnique({
          where: { id: updateData.serviceTypeId },
          select: { id: true, branchId: true },
        });
        
        if (!serviceType) {
          res.status(400).json({
            success: false,
            error: 'Service type not found',
          });
          return;
        }
        
        if (serviceType.branchId !== existingSlot.branchId) {
          res.status(400).json({
            success: false,
            error: 'Service type does not belong to this branch',
          });
          return;
        }
      }
      
      // Validate time range if both times are being updated
      if (updateData.startTime && updateData.endTime) {
        const startTime = new Date(updateData.startTime);
        const endTime = new Date(updateData.endTime);
        
        if (endTime <= startTime) {
          res.status(400).json({
            success: false,
            error: 'End time must be after start time',
          });
          return;
        }
      }
      
      const slot = await prisma.slot.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          startTime: true,
          endTime: true,
          capacity: true,
          bookedCount: true,
          isActive: true,
          updatedAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          serviceType: {
            select: {
              id: true,
              name: true,
              code: true,
              duration: true,
            },
          },
        },
      });
      
      // Audit log: slot updated
      await logAudit(
        req.user?.userId,
        'SLOT_UPDATED',
        'Slot',
        id,
        {
          branchId: existingSlot.branchId,
          changes: updateData,
          previousCapacity: existingSlot.capacity,
        },
        getIpAddressFromRequest(req)
      );
      
      res.json({
        success: true,
        data: slot,
        message: 'Time slot updated successfully',
      });
    } catch (error: any) {
      console.error('Error updating slot:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
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

// DELETE /api/slots/:id - Soft delete slot (ADMIN/BRANCH_MANAGER)
// Sets deletedAt timestamp instead of hard deleting. Can be restored by clearing deletedAt.
router.delete('/:id', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const existingSlot = await prisma.slot.findUnique({
        where: { id },
        select: { branchId: true, bookedCount: true, appointments: true, deletedAt: true },
      });
      
      if (!existingSlot) {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
        });
        return;
      }
      
      // BRANCH_MANAGER can only delete slots in their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && existingSlot.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only delete slots in your assigned branch',
        });
        return;
      }
      
      // Cannot soft-delete slot with existing appointments (same as hard delete)
      if (existingSlot.bookedCount > 0) {
        res.status(400).json({
          success: false,
          error: 'Cannot delete time slot with existing appointments',
        });
        return;
      }
      
      // Soft delete: set deletedAt timestamp instead of deleting
      const slot = await prisma.slot.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          capacity: true,
          bookedCount: true,
          isActive: true,
          deletedAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          serviceType: {
            select: {
              id: true,
              name: true,
              code: true,
              duration: true,
            },
          },
        },
      });
      
      // Audit log: slot deleted (soft delete)
      await logAudit(
        req.user?.userId,
        'SLOT_DELETED',
        'Slot',
        id,
        {
          branchId: existingSlot.branchId,
          bookedCount: existingSlot.bookedCount,
          softDelete: true,
        },
        getIpAddressFromRequest(req)
      );
      
      res.json({
        success: true,
        message: 'Time slot soft deleted successfully',
        data: slot,
      });
    } catch (error: any) {
      console.error('Error soft deleting slot:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
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

// POST /api/slots/:id/restore - Restore a soft-deleted slot (ADMIN only)
// Clears deletedAt to make the slot visible again
router.post('/:id/restore', authMiddleware,
  roleMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      const existingSlot = await prisma.slot.findUnique({
        where: { id },
        select: { id: true, deletedAt: true, branchId: true },
      });
      
      if (!existingSlot) {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
        });
        return;
      }
      
      // Can only restore if it's actually soft-deleted
      if (!existingSlot.deletedAt) {
        res.status(400).json({
          success: false,
          error: 'Slot is not soft deleted',
        });
        return;
      }
      
      const slot = await prisma.slot.update({
        where: { id },
        data: { deletedAt: null },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          capacity: true,
          bookedCount: true,
          isActive: true,
          deletedAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          serviceType: {
            select: {
              id: true,
              name: true,
              code: true,
              duration: true,
            },
          },
        },
      });
      
      // Audit log: slot restored
      await logAudit(
        req.user?.userId,
        'SLOT_RESTORED',
        'Slot',
        id,
        {
          branchId: existingSlot.branchId,
          restoredAt: new Date().toISOString(),
        },
        getIpAddressFromRequest(req)
      );
      
      res.json({
        success: true,
        message: 'Time slot restored successfully',
        data: slot,
      });
    } catch (error: any) {
      console.error('Error restoring slot:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
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
