import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, roleMiddleware, branchScopedMiddleware } from '../middleware/auth.js';
import { createBranchSchema, updateBranchSchema } from '../types/index.js';
import { logAuditFromRequest } from '../utils/audit-logger.js';

const router = Router();
const prisma = new PrismaClient();

// All branch routes require authentication

// GET /api/branches - List all branches
// ADMIN: all branches
// BRANCH_MANAGER/STAFF: filtered to their branch
router.get('/', async (req: Request, res: Response) => {
  try {
    const { isActive } = req.query;
    
    let whereClause: any = {};
    
    // BRANCH_MANAGER and STAFF can only see their own branch
    if (req.user?.role === 'BRANCH_MANAGER' || req.user?.role === 'STAFF') {
      if (req.user?.branchId) {
        whereClause.id = req.user.branchId;
      }
    }
    
    // Filter by active status if provided
    if (isActive !== undefined) {
      whereClause.isActive = isActive === 'true';
    }
    
    const branches = await prisma.branch.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        city: true,
        phone: true,
        email: true,
        isActive: true,
        timezone: true,
        createdAt: true,
        _count: {
          select: {
            staff: true,
            serviceTypes: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    
    res.json({
      success: true,
      data: branches,
    });
  } catch (error) {
    console.error('Error listing branches:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /api/branches - Create branch (ADMIN only)
router.post('/', authMiddleware, roleMiddleware('ADMIN'), async (req: Request, res: Response) => {
  try {
    const validation = createBranchSchema.safeParse(req.body);
    
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.errors,
      });
      return;
    }
    
    const data = validation.data;
    
    // Check if code already exists
    const existing = await prisma.branch.findUnique({
      where: { code: data.code },
    });
    
    if (existing) {
      res.status(409).json({
        success: false,
        error: 'Branch with this code already exists',
      });
      return;
    }
    
    const branch = await prisma.branch.create({
      data: {
        name: data.name,
        code: data.code,
        address: data.address,
        city: data.city,
        phone: data.phone,
        email: data.email,
        timezone: data.timezone,
      },
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        city: true,
        phone: true,
        email: true,
        isActive: true,
        timezone: true,
        createdAt: true,
      },
    });

    await logAuditFromRequest(
      req,
      'BRANCH_CREATED',
      'Branch',
      branch.id,
      {
        branchId: branch.id,
        code: branch.code,
        name: branch.name,
      },
      branch.id
    );
    
    res.status(201).json({
      success: true,
      data: branch,
      message: 'Branch created successfully',
    });
  } catch (error) {
    console.error('Error creating branch:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /api/branches/:id - Get branch details
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    
    // Check branch access
    if (req.user?.role === 'BRANCH_MANAGER' || req.user?.role === 'STAFF') {
      if (req.user?.branchId && id !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Cannot access branches outside your assigned branch',
        });
        return;
      }
    }
    
    const branch = await prisma.branch.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        city: true,
        phone: true,
        email: true,
        isActive: true,
        timezone: true,
        createdAt: true,
        updatedAt: true,
        staff: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            position: true,
            isManager: true,
          },
        },
        serviceTypes: {
          select: {
            id: true,
            name: true,
            code: true,
            description: true,
            duration: true,
            isActive: true,
          },
        },
        _count: {
          select: {
            appointments: true,
            slots: true,
          },
        },
      },
    });
    
    if (!branch) {
      res.status(404).json({
        success: false,
        error: 'Branch not found',
      });
      return;
    }
    
    res.json({
      success: true,
      data: branch,
    });
  } catch (error) {
    console.error('Error getting branch:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// PATCH /api/branches/:id - Update branch (ADMIN/BRANCH_MANAGER)
router.patch('/:id', authMiddleware, 
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const validation = updateBranchSchema.safeParse(req.body);
      
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }
      
      // BRANCH_MANAGER can only update their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && req.user?.branchId !== id) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only update your assigned branch',
        });
        return;
      }
      
      const branch = await prisma.branch.update({
        where: { id },
        data: validation.data,
        select: {
          id: true,
          name: true,
          code: true,
          address: true,
          city: true,
          phone: true,
          email: true,
          isActive: true,
          timezone: true,
          updatedAt: true,
        },
      });

      await logAuditFromRequest(
        req,
        'BRANCH_UPDATED',
        'Branch',
        id,
        {
          branchId: id,
          changes: validation.data,
        },
        id
      );
      
      res.json({
        success: true,
        data: branch,
        message: 'Branch updated successfully',
      });
    } catch (error: any) {
      console.error('Error updating branch:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Branch not found',
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

// DELETE /api/branches/:id - Delete branch (ADMIN only)
router.delete('/:id', authMiddleware, roleMiddleware('ADMIN'), async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const branch = await prisma.branch.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });

    if (!branch) {
      res.status(404).json({
        success: false,
        error: 'Branch not found',
      });
      return;
    }

    await prisma.branch.delete({
      where: { id },
    });

    await logAuditFromRequest(
      req,
      'BRANCH_DELETED',
      'Branch',
      id,
      {
        branchId: id,
        code: branch.code,
        name: branch.name,
      },
      id
    );
    
    res.json({
      success: true,
      message: 'Branch deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting branch:', error);
    if (error.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: 'Branch not found',
      });
    } else if (error.code?.startsWith('P200')) {
      res.status(400).json({
        success: false,
        error: 'Cannot delete branch with existing related records',
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
});

export default router;
