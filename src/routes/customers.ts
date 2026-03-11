import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { createCustomerSchema, updateCustomerSchema } from '../types/index.js';

const router = Router();
const prisma = new PrismaClient();

// All customer routes require authentication
router.use(authMiddleware);

// GET /api/customers - List customers
// ADMIN: all customers
// BRANCH_MANAGER/STAFF: customers with appointments at their branch
// CUSTOMER: own profile only
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, branchId } = req.query;
    
    let whereClause: any = {};
    
    // Role-based filtering
    if (req.user?.role === 'STAFF') {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      });
      return;
    }

    if (req.user?.role === 'CUSTOMER') {
      // CUSTOMER can only view their own profile
      if (!req.user?.customerId) {
        res.status(403).json({
          success: false,
          error: 'Customer profile not found',
        });
        return;
      }
      whereClause.id = req.user.customerId;
    } else if (req.user?.role === 'BRANCH_MANAGER') {
      // BRANCH_MANAGER can view customers who have appointments at their branch
      if (req.user?.branchId) {
        whereClause.appointments = {
          some: {
            branchId: req.user.branchId,
          },
        };
      }
    }
    // ADMIN can view all customers (no filter)
    
    // Search filter
    if (search) {
      whereClause.user = {
        OR: [
          { firstName: { contains: search as string, mode: 'insensitive' } },
          { lastName: { contains: search as string, mode: 'insensitive' } },
          { email: { contains: search as string, mode: 'insensitive' } },
        ],
      };
    }
    
    const customers = await prisma.customer.findMany({
      where: whereClause,
      select: {
        id: true,
        idNumber: true,
        dateOfBirth: true,
        idImageUrl: true,
        createdAt: true,
        updatedAt: true,
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
        _count: {
          select: {
            appointments: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    
    res.json({
      success: true,
      data: customers,
    });
  } catch (error) {
    console.error('Error listing customers:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /api/customers - Create customer profile
// ADMIN/BRANCH_MANAGER/STAFF: can create customer profiles
// CUSTOMER: can create their own profile (auto-linked)
router.post('/',
  async (req: Request, res: Response) => {
    try {
      const validation = createCustomerSchema.safeParse(req.body);
      
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }
      
      const data = validation.data;
      
      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: data.userId },
        select: { id: true, role: true },
      });
      
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found',
        });
        return;
      }
      
      // CUSTOMER role users can only create their own profile
      if (req.user?.role === 'CUSTOMER') {
        if (data.userId !== req.user.userId) {
          res.status(403).json({
            success: false,
            error: 'Can only create your own customer profile',
          });
          return;
        }
      }
      
      // Check if customer profile already exists for this user
      const existing = await prisma.customer.findUnique({
        where: { userId: data.userId },
      });
      
      if (existing) {
        res.status(409).json({
          success: false,
          error: 'Customer profile already exists for this user',
        });
        return;
      }
      
      // Ensure user has CUSTOMER role
      if (user.role !== 'CUSTOMER') {
        res.status(400).json({
          success: false,
          error: 'Can only create customer profile for users with CUSTOMER role',
        });
        return;
      }
      
      const customer = await prisma.customer.create({
        data: {
          userId: data.userId,
          idNumber: data.idNumber,
          dateOfBirth: new Date(data.dateOfBirth),
          idImageUrl: data.idImageUrl,
        },
        select: {
          id: true,
          idNumber: true,
          dateOfBirth: true,
          idImageUrl: true,
          createdAt: true,
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
        },
      });
      
      res.status(201).json({
        success: true,
        data: customer,
        message: 'Customer profile created successfully',
      });
    } catch (error) {
      console.error('Error creating customer:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// GET /api/customers/:id - Get customer details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        idNumber: true,
        dateOfBirth: true,
        idImageUrl: true,
        createdAt: true,
        updatedAt: true,
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
        appointments: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            branch: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            slot: {
              select: {
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
          take: 20,
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            appointments: true,
          },
        },
      },
    });
    
    if (!customer) {
      res.status(404).json({
        success: false,
        error: 'Customer not found',
      });
      return;
    }
    
    // Check access permissions
    if (req.user?.role === 'STAFF') {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      });
      return;
    }

    if (req.user?.role === 'CUSTOMER') {
      // CUSTOMER can only view their own profile
      if (!req.user?.customerId || customer.id !== req.user.customerId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only view your own customer profile',
        });
        return;
      }
    } else if (req.user?.role === 'BRANCH_MANAGER') {
      // BRANCH_MANAGER can only view customers with appointments at their branch
      if (req.user?.branchId) {
        const hasAppointmentAtBranch = await prisma.appointment.findFirst({
          where: {
            customerId: customer.id,
            branchId: req.user.branchId,
          },
        });

        if (!hasAppointmentAtBranch) {
          res.status(403).json({
            success: false,
            error: 'Access denied: Customer has no appointments at your branch',
          });
          return;
        }
      }
    }
    // ADMIN can view all customers
    
    res.json({
      success: true,
      data: customer,
    });
  } catch (error) {
    console.error('Error getting customer:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// PATCH /api/customers/:id - Update customer
router.patch('/:id',
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const validation = updateCustomerSchema.safeParse(req.body);
      
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }
      
      const existingCustomer = await prisma.customer.findUnique({
        where: { id },
        select: { userId: true },
      });
      
      if (!existingCustomer) {
        res.status(404).json({
          success: false,
          error: 'Customer not found',
        });
        return;
      }
      
      // Check access permissions
      if (req.user?.role === 'CUSTOMER') {
        // CUSTOMER can only update their own profile
        if (!req.user?.customerId || existingCustomer.userId !== req.user.userId) {
          res.status(403).json({
            success: false,
            error: 'Access denied: Can only update your own customer profile',
          });
          return;
        }
      }
      // ADMIN/BRANCH_MANAGER/STAFF can update any customer profile
      
      const updateData = validation.data;
      
      // Convert dateOfBirth to Date if provided
      const prismaUpdateData: any = { ...updateData };
      if (updateData.dateOfBirth) {
        prismaUpdateData.dateOfBirth = new Date(updateData.dateOfBirth);
      }
      
      const customer = await prisma.customer.update({
        where: { id },
        data: prismaUpdateData,
        select: {
          id: true,
          idNumber: true,
          dateOfBirth: true,
          idImageUrl: true,
          updatedAt: true,
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
        },
      });
      
      res.json({
        success: true,
        data: customer,
        message: 'Customer profile updated successfully',
      });
    } catch (error: any) {
      console.error('Error updating customer:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Customer not found',
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
