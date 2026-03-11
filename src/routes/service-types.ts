import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, roleMiddleware, branchScopedMiddleware } from '../middleware/auth.js';
import { createServiceTypeSchema, updateServiceTypeSchema } from '../types/index.js';
import { logAuditFromRequest } from '../utils/audit-logger.js';

const router = Router();
const prisma = new PrismaClient();

// All service type routes require authentication

// GET /api/service-types - List service types
// ADMIN: all service types
// BRANCH_MANAGER/STAFF: service types in their branch
// CUSTOMER: service types in all active branches (for booking)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { branchId, isActive } = req.query;
    
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
    
    // Filter by active status
    if (isActive !== undefined) {
      whereClause.isActive = isActive === 'true';
    }
    
    const serviceTypes = await prisma.serviceType.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        duration: true,
        isActive: true,
        createdAt: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            slots: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    
    res.json({
      success: true,
      data: serviceTypes,
    });
  } catch (error) {
    console.error('Error listing service types:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /api/service-types - Create service type (ADMIN/BRANCH_MANAGER)
router.post('/', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const validation = createServiceTypeSchema.safeParse(req.body);
      
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }
      
      const data = validation.data;
      
      // BRANCH_MANAGER can only create service types in their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && req.user?.branchId !== data.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only create service types in your assigned branch',
        });
        return;
      }
      
      // Check if code already exists for this branch
      const existing = await prisma.serviceType.findUnique({
        where: {
          branchId_code: {
            branchId: data.branchId,
            code: data.code,
          },
        },
      });
      
      if (existing) {
        res.status(409).json({
          success: false,
          error: 'Service type with this code already exists in the branch',
        });
        return;
      }
      
      const serviceType = await prisma.serviceType.create({
        data: {
          branchId: data.branchId,
          name: data.name,
          code: data.code,
          description: data.description,
          duration: data.duration,
        },
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          duration: true,
          isActive: true,
          createdAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });

      await logAuditFromRequest(
        req,
        'SERVICE_TYPE_CREATED',
        'ServiceType',
        serviceType.id,
        {
          branchId: data.branchId,
          code: serviceType.code,
          name: serviceType.name,
          duration: serviceType.duration,
        },
        data.branchId
      );
      
      res.status(201).json({
        success: true,
        data: serviceType,
        message: 'Service type created successfully',
      });
    } catch (error) {
      console.error('Error creating service type:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// GET /api/service-types/:id - Get service type details
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    
    const serviceType = await prisma.serviceType.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        duration: true,
        isActive: true,
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
        slots: {
          select: {
            id: true,
            startTime: true,
            endTime: true,
            capacity: true,
            bookedCount: true,
            isActive: true,
          },
          take: 20,
          orderBy: { startTime: 'desc' },
        },
        _count: {
          select: {
            slots: true,
          },
        },
      },
    });
    
    if (!serviceType) {
      res.status(404).json({
        success: false,
        error: 'Service type not found',
      });
      return;
    }
    
    // Check access: BRANCH_MANAGER/STAFF can only view service types in their branch
    if (req.user?.role === 'BRANCH_MANAGER' || req.user?.role === 'STAFF') {
      if (req.user?.branchId && serviceType.branch.id !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Cannot view service types outside your branch',
        });
        return;
      }
    }
    
    res.json({
      success: true,
      data: serviceType,
    });
  } catch (error) {
    console.error('Error getting service type:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// PATCH /api/service-types/:id - Update service type (ADMIN/BRANCH_MANAGER)
router.patch('/:id', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const validation = updateServiceTypeSchema.safeParse(req.body);
      
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }
      
      const existingServiceType = await prisma.serviceType.findUnique({
        where: { id },
        select: { branchId: true, code: true },
      });
      
      if (!existingServiceType) {
        res.status(404).json({
          success: false,
          error: 'Service type not found',
        });
        return;
      }
      
      // BRANCH_MANAGER can only update service types in their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && existingServiceType.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only update service types in your assigned branch',
        });
        return;
      }
      
      // Check for code uniqueness if code is being updated
      if (validation.data.code && validation.data.code !== existingServiceType.code) {
        const existing = await prisma.serviceType.findUnique({
          where: {
            branchId_code: {
              branchId: existingServiceType.branchId,
              code: validation.data.code,
            },
          },
        });
        
        if (existing) {
          res.status(409).json({
            success: false,
            error: 'Service type with this code already exists in the branch',
          });
          return;
        }
      }
      
      const serviceType = await prisma.serviceType.update({
        where: { id },
        data: validation.data,
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          duration: true,
          isActive: true,
          updatedAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });

      await logAuditFromRequest(
        req,
        'SERVICE_TYPE_UPDATED',
        'ServiceType',
        id,
        {
          branchId: existingServiceType.branchId,
          changes: validation.data,
        },
        existingServiceType.branchId
      );
      
      res.json({
        success: true,
        data: serviceType,
        message: 'Service type updated successfully',
      });
    } catch (error: any) {
      console.error('Error updating service type:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Service type not found',
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

// GET /api/service-types/:id/staff - List staff assigned to a service type
router.get('/:id/staff', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  async (req: Request, res: Response) => {
    try {
      const serviceTypeId = String(req.params.id);

      const serviceType = await prisma.serviceType.findUnique({
        where: { id: serviceTypeId },
        select: { id: true, branchId: true },
      });

      if (!serviceType) {
        res.status(404).json({
          success: false,
          error: 'Service type not found',
        });
        return;
      }

      if (req.user?.role === 'BRANCH_MANAGER' && serviceType.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Cannot view staff assignments outside your branch',
        });
        return;
      }

      const assignments = await prisma.staffServiceAssignment.findMany({
        where: { serviceTypeId },
        select: {
          id: true,
          createdAt: true,
          staff: {
            select: {
              id: true,
              position: true,
              employeeId: true,
              user: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        data: assignments,
      });
    } catch (error) {
      console.error('Error listing service type staff:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// POST /api/service-types/:id/assign-staff - Assign staff to a service type
router.post('/:id/assign-staff', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  async (req: Request, res: Response) => {
    try {
      const serviceTypeId = String(req.params.id);
      const { staffId } = req.body;

      if (!staffId || typeof staffId !== 'string') {
        res.status(400).json({
          success: false,
          error: 'staffId is required',
        });
        return;
      }

      const serviceType = await prisma.serviceType.findUnique({
        where: { id: serviceTypeId },
        select: { id: true, branchId: true, name: true },
      });

      if (!serviceType) {
        res.status(404).json({
          success: false,
          error: 'Service type not found',
        });
        return;
      }

      if (req.user?.role === 'BRANCH_MANAGER' && serviceType.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Cannot assign staff outside your branch',
        });
        return;
      }

      const staff = await prisma.staff.findUnique({
        where: { id: staffId },
        select: { id: true, branchId: true, user: { select: { email: true } } },
      });

      if (!staff) {
        res.status(404).json({
          success: false,
          error: 'Staff member not found',
        });
        return;
      }

      if (staff.branchId !== serviceType.branchId) {
        res.status(400).json({
          success: false,
          error: 'Staff member must belong to the same branch as the service type',
        });
        return;
      }

      const existing = await prisma.staffServiceAssignment.findUnique({
        where: {
          staffId_serviceTypeId_branchId: {
            staffId,
            serviceTypeId,
            branchId: serviceType.branchId,
          },
        },
      });

      if (existing) {
        res.json({
          success: true,
          data: existing,
          message: 'Staff already assigned to this service type',
        });
        return;
      }

      const assignment = await prisma.staffServiceAssignment.create({
        data: {
          staffId,
          serviceTypeId,
          branchId: serviceType.branchId,
        },
        select: {
          id: true,
          createdAt: true,
          staff: {
            select: {
              id: true,
              position: true,
              user: {
                select: {
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          serviceType: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });

      await logAuditFromRequest(
        req,
        'STAFF_SERVICE_ASSIGNED',
        'StaffServiceAssignment',
        assignment.id,
        {
          staffId,
          serviceTypeId,
          branchId: serviceType.branchId,
          staffEmail: staff.user.email,
          serviceTypeName: serviceType.name,
        },
        serviceType.branchId
      );

      res.status(201).json({
        success: true,
        data: assignment,
        message: 'Staff assigned to service type successfully',
      });
    } catch (error) {
      console.error('Error assigning staff to service type:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// DELETE /api/service-types/:id/assign-staff/:staffId - Remove staff from a service type
router.delete('/:id/assign-staff/:staffId', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  async (req: Request, res: Response) => {
    try {
      const serviceTypeId = String(req.params.id);
      const staffId = String(req.params.staffId);

      const serviceType = await prisma.serviceType.findUnique({
        where: { id: serviceTypeId },
        select: { id: true, branchId: true, name: true },
      });

      if (!serviceType) {
        res.status(404).json({
          success: false,
          error: 'Service type not found',
        });
        return;
      }

      if (req.user?.role === 'BRANCH_MANAGER' && serviceType.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Cannot manage staff assignments outside your branch',
        });
        return;
      }

      const assignment = await prisma.staffServiceAssignment.findUnique({
        where: {
          staffId_serviceTypeId_branchId: {
            staffId,
            serviceTypeId,
            branchId: serviceType.branchId,
          },
        },
      });

      if (!assignment) {
        res.status(404).json({
          success: false,
          error: 'Staff assignment not found',
        });
        return;
      }

      await prisma.staffServiceAssignment.delete({
        where: { id: assignment.id },
      });

      await logAuditFromRequest(
        req,
        'STAFF_SERVICE_UNASSIGNED',
        'StaffServiceAssignment',
        assignment.id,
        {
          staffId,
          serviceTypeId,
          branchId: serviceType.branchId,
          serviceTypeName: serviceType.name,
        },
        serviceType.branchId
      );

      res.json({
        success: true,
        message: 'Staff removed from service type successfully',
      });
    } catch (error) {
      console.error('Error removing staff from service type:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// DELETE /api/service-types/:id - Delete service type (ADMIN/BRANCH_MANAGER)
router.delete('/:id', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      
      const existingServiceType = await prisma.serviceType.findUnique({
        where: { id },
        select: { branchId: true },
      });
      
      if (!existingServiceType) {
        res.status(404).json({
          success: false,
          error: 'Service type not found',
        });
        return;
      }
      
      // BRANCH_MANAGER can only delete service types in their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && existingServiceType.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only delete service types in your assigned branch',
        });
        return;
      }
      
      await prisma.serviceType.delete({
        where: { id },
      });

      await logAuditFromRequest(
        req,
        'SERVICE_TYPE_DELETED',
        'ServiceType',
        id,
        {
          branchId: existingServiceType.branchId,
        },
        existingServiceType.branchId
      );
      
      res.json({
        success: true,
        message: 'Service type deleted successfully',
      });
    } catch (error: any) {
      console.error('Error deleting service type:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Service type not found',
        });
      } else if (error.code?.startsWith('P200')) {
        res.status(400).json({
          success: false,
          error: 'Cannot delete service type with existing related records (slots)',
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
