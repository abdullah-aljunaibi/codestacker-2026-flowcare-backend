import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { authMiddleware } from '../middleware/auth.js';
import { registerSchema } from '../types/index.js';

const router = Router();
const prisma = new PrismaClient();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const validation = registerSchema.safeParse(req.body);
    
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.errors,
      });
      return;
    }

    const { email, password, firstName, lastName, phone } = validation.data;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.status(409).json({
        success: false,
        error: 'User with this email already exists',
      });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone,
        role: 'CUSTOMER',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
    });

    // If registering as CUSTOMER, create customer profile
    const customer = await prisma.customer.create({
      data: {
        userId: user.id,
        idNumber: `ID${Date.now()}`,
        dateOfBirth: new Date('2000-01-01'),
      },
    });

    res.status(201).json({
      success: true,
      data: {
        user,
        customer: {
          id: customer.id,
          userId: customer.userId,
        },
      },
      message: 'Registration successful. Use Basic Auth with your email and password on protected routes.',
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /api/auth/login - Basic Auth credential validation endpoint
router.post('/login', authMiddleware, async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      user: {
        id: req.user?.userId,
        email: req.user?.email,
        role: req.user?.role,
        branchId: req.user?.branchId,
        customerId: req.user?.customerId,
        staffId: req.user?.staffId,
      },
    },
    message: 'Credentials are valid. Use the same Basic Auth header on protected routes.',
  });
});

export default router;
