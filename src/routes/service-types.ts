import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, roleMiddleware, branchScopedMiddleware } from '../middleware/auth.js';
import { createServiceTypeSchema, updateServiceTypeSchema } from '../types/index.js';

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
    const { id } = req.params;
    
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
      const { id } = req.params;
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

// DELETE /api/service-types/:id - Delete service type (ADMIN/BRANCH_MANAGER)
router.delete('/:id', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
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
