import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, roleMiddleware, branchScopedMiddleware } from '../middleware/auth.js';
import { createStaffSchema, updateStaffSchema } from '../types/index.js';
import { logAudit, getIpAddressFromRequest } from '../utils/audit-logger.js';

const router = Router();
const prisma = new PrismaClient();

// All staff routes require authentication
router.use(authMiddleware);

// GET /api/staff - List staff members
// ADMIN: all staff
// BRANCH_MANAGER: staff in their branch
// STAFF: can view their own branch colleagues
router.get('/', 
  roleMiddleware('ADMIN', 'BRANCH_MANAGER', 'STAFF'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const { branchId, isManager } = req.query;
      
      let whereClause: any = {};
      
      // Filter by branch
      if (branchId) {
        whereClause.branchId = branchId as string;
      } else if (req.user?.branchId) {
        // Auto-filter to user's branch for non-ADMIN
        whereClause.branchId = req.user.branchId;
      }
      
      // Filter by manager flag
      if (isManager !== undefined) {
        whereClause.isManager = isManager === 'true';
      }
      
      const staff = await prisma.staff.findMany({
        where: whereClause,
        select: {
          id: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              role: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          position: true,
          employeeId: true,
          isManager: true,
          createdAt: true,
          _count: {
            select: {
              appointments: true,
              slotAssignments: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      
      res.json({
        success: true,
        data: staff,
      });
    } catch (error) {
      console.error('Error listing staff:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// POST /api/staff - Create staff record (ADMIN/BRANCH_MANAGER)
router.post('/',
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const validation = createStaffSchema.safeParse(req.body);
      
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }
      
      const data = validation.data;
      
      // BRANCH_MANAGER can only create staff in their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && req.user?.branchId !== data.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only create staff in your assigned branch',
        });
        return;
      }
      
      // Verify user exists and has appropriate role
      const user = await prisma.user.findUnique({
        where: { id: data.userId },
      });
      
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found',
        });
        return;
      }
      
      // Ensure role matches staff assignment
      const requiredRole = data.isManager ? 'BRANCH_MANAGER' : 'STAFF';
      if (user.role !== requiredRole) {
        res.status(400).json({
          success: false,
          error: `User role must be ${requiredRole} for this staff assignment`,
        });
        return;
      }
      
      // Check if staff profile already exists
      const existing = await prisma.staff.findUnique({
        where: { userId: data.userId },
      });
      
      if (existing) {
        res.status(409).json({
          success: false,
          error: 'User already has a staff profile',
        });
        return;
      }
      
      const staff = await prisma.staff.create({
        data: {
          userId: data.userId,
          branchId: data.branchId,
          position: data.position,
          employeeId: data.employeeId,
          isManager: data.isManager,
        },
        select: {
          id: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          position: true,
          employeeId: true,
          isManager: true,
          createdAt: true,
        },
      });
      
      // Audit log: staff assigned
      await logAudit(
        req.user?.userId,
        'STAFF_ASSIGNED',
        'Staff',
        staff.id,
        {
          userId: data.userId,
          branchId: data.branchId,
          position: data.position,
          isManager: data.isManager,
          userEmail: staff.user.email,
        },
        getIpAddressFromRequest(req)
      );
      
      res.status(201).json({
        success: true,
        data: staff,
        message: 'Staff record created successfully',
      });
    } catch (error) {
      console.error('Error creating staff:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// GET /api/staff/:id - Get staff details
router.get('/:id',
  roleMiddleware('ADMIN', 'BRANCH_MANAGER', 'STAFF'),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      
      const staff = await prisma.staff.findUnique({
        where: { id },
        select: {
          id: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              role: true,
              createdAt: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
              address: true,
              city: true,
            },
          },
          position: true,
          employeeId: true,
          isManager: true,
          createdAt: true,
          appointments: {
            select: {
              id: true,
              status: true,
              createdAt: true,
              customer: {
                select: {
                  user: {
                    select: {
                      firstName: true,
                      lastName: true,
                    },
                  },
                },
              },
            },
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
          slotAssignments: {
            select: {
              id: true,
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
            take: 10,
          },
        },
      });
      
      if (!staff) {
        res.status(404).json({
          success: false,
          error: 'Staff member not found',
        });
        return;
      }
      
      // Check access: ADMIN can see all, BRANCH_MANAGER/STAFF can see own branch
      if (req.user?.role === 'BRANCH_MANAGER' || req.user?.role === 'STAFF') {
        if (req.user?.branchId && staff.branch.id !== req.user.branchId) {
          res.status(403).json({
            success: false,
            error: 'Access denied: Cannot view staff outside your branch',
          });
          return;
        }
      }
      
      res.json({
        success: true,
        data: staff,
      });
    } catch (error) {
      console.error('Error getting staff:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// PATCH /api/staff/:id - Update staff (ADMIN/BRANCH_MANAGER)
router.patch('/:id',
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const validation = updateStaffSchema.safeParse(req.body);
      
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }
      
      const existingStaff = await prisma.staff.findUnique({
        where: { id },
        select: { 
          branchId: true,
          branch: {
            select: {
              id: true,
            },
          },
        },
      });
      
      if (!existingStaff) {
        res.status(404).json({
          success: false,
          error: 'Staff member not found',
        });
        return;
      }
      
      // BRANCH_MANAGER can only update staff in their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && existingStaff.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only update staff in your assigned branch',
        });
        return;
      }
      
      const staff = await prisma.staff.update({
        where: { id },
        data: validation.data,
        select: {
          id: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          position: true,
          employeeId: true,
          isManager: true,
          updatedAt: true,
        },
      });
      
      // Audit log: staff assignment changed
      const updateData = validation.data;
      const hasBranchChange = updateData.branchId && updateData.branchId !== existingStaff.branchId;
      const hasPositionChange = updateData.position !== undefined;
      const hasManagerChange = updateData.isManager !== undefined;
      
      if (hasBranchChange || hasPositionChange || hasManagerChange) {
        await logAudit(
          req.user?.userId,
          'STAFF_ASSIGNMENT_CHANGED',
          'Staff',
          id,
          {
            userId: staff.user.id,
            previousBranchId: existingStaff.branchId,
            newBranchId: updateData.branchId || existingStaff.branchId,
            changes: updateData,
            userEmail: staff.user.email,
          },
          getIpAddressFromRequest(req)
        );
      }
      
      res.json({
        success: true,
        data: staff,
        message: 'Staff record updated successfully',
      });
    } catch (error: any) {
      console.error('Error updating staff:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Staff member not found',
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

// DELETE /api/staff/:id - Delete staff (ADMIN/BRANCH_MANAGER)
router.delete('/:id',
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      
      const existingStaff = await prisma.staff.findUnique({
        where: { id },
        select: { 
          branchId: true,
          branch: {
            select: {
              id: true,
            },
          },
        },
      });
      
      if (!existingStaff) {
        res.status(404).json({
          success: false,
          error: 'Staff member not found',
        });
        return;
      }
      
      // BRANCH_MANAGER can only delete staff in their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && existingStaff.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only delete staff in your assigned branch',
        });
        return;
      }
      
      await prisma.staff.delete({
        where: { id },
      });
      
      // Audit log: staff unassigned
      await logAudit(
        req.user?.userId,
        'STAFF_UNASSIGNED',
        'Staff',
        id,
        {
          branchId: existingStaff.branchId,
        },
        getIpAddressFromRequest(req)
      );
      
      res.json({
        success: true,
        message: 'Staff record deleted successfully',
      });
    } catch (error: any) {
      console.error('Error deleting staff:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Staff member not found',
        });
      } else if (error.code?.startsWith('P200')) {
        res.status(400).json({
          success: false,
          error: 'Cannot delete staff with existing related records',
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
