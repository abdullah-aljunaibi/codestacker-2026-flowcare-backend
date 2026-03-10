import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { authenticateBasicCredentials, parseBasicAuthHeader } from '../middleware/auth.js';
import upload, { handleMulterError } from '../middleware/upload.js';
import { registerSchema } from '../types/index.js';
import { getIpAddressFromRequest, logAudit } from '../utils/audit-logger.js';
import fs from 'fs';

const router = Router();
const prisma = new PrismaClient();

function removeUploadedFile(filePath?: string) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// POST /api/auth/register
router.post('/register', upload.single('idImage'), handleMulterError, async (req: Request, res: Response) => {
  try {
    const validation = registerSchema.safeParse(req.body);
    
    if (!validation.success) {
      removeUploadedFile(req.file?.path);
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.errors,
      });
      return;
    }

    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'ID image file is required',
      });
      return;
    }

    const { email, password, firstName, lastName, phone, idNumber, dateOfBirth } = validation.data;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      removeUploadedFile(req.file.path);
      res.status(409).json({
        success: false,
        error: 'User with this email already exists',
      });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const idImageUrl = `/uploads/customer-ids/${req.file.filename}`;

    const { user, customer } = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
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

      const createdCustomer = await tx.customer.create({
        data: {
          userId: createdUser.id,
          idNumber,
          dateOfBirth: new Date(dateOfBirth),
          idImageUrl,
        },
      });

      return { user: createdUser, customer: createdCustomer };
    });

    await logAudit(
      user.id,
      'USER_REGISTERED',
      'Customer',
      customer.id,
      {
        userEmail: user.email,
        customerId: customer.id,
      },
      getIpAddressFromRequest(req)
    );

    res.status(201).json({
      success: true,
      data: {
        user,
        customer: {
          id: customer.id,
          userId: customer.userId,
          idNumber: customer.idNumber,
          dateOfBirth: customer.dateOfBirth,
          idImageUrl: customer.idImageUrl,
        },
      },
      message: 'Registration successful. Use Basic Auth with your email and password on protected routes.',
    });
  } catch (error) {
    removeUploadedFile(req.file?.path);
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /api/auth/login - Basic Auth credential validation endpoint
router.post('/login', async (req: Request, res: Response) => {
  const credentials = parseBasicAuthHeader(req.headers.authorization);
  const ipAddress = getIpAddressFromRequest(req);

  if (!credentials) {
    await logAudit(
      null,
      'AUTH_LOGIN_FAILED',
      'User',
      undefined,
      {
        reason: 'Missing or invalid Basic Authentication header',
      },
      ipAddress
    );

    res.setHeader('WWW-Authenticate', 'Basic realm="FlowCare"');
    res.status(401).json({
      success: false,
      error: 'Invalid or missing Basic Authentication credentials',
    });
    return;
  }

  const authenticatedUser = await authenticateBasicCredentials(credentials);

  if (!authenticatedUser) {
    await logAudit(
      null,
      'AUTH_LOGIN_FAILED',
      'User',
      undefined,
      {
        email: credentials.email,
        reason: 'Invalid email or password',
      },
      ipAddress
    );

    res.setHeader('WWW-Authenticate', 'Basic realm="FlowCare"');
    res.status(401).json({
      success: false,
      error: 'Invalid or missing Basic Authentication credentials',
    });
    return;
  }

  await logAudit(
    authenticatedUser.userId,
    'AUTH_LOGIN_SUCCEEDED',
    'User',
    authenticatedUser.userId,
    {
      email: authenticatedUser.email,
      role: authenticatedUser.role,
      branchId: authenticatedUser.branchId,
    },
    ipAddress,
    authenticatedUser.branchId
  );

  res.json({
    success: true,
    data: {
      user: {
        id: authenticatedUser.userId,
        email: authenticatedUser.email,
        role: authenticatedUser.role,
        branchId: authenticatedUser.branchId,
        customerId: authenticatedUser.customerId,
        staffId: authenticatedUser.staffId,
      },
    },
    message: 'Credentials are valid. Use the same Basic Auth header on protected routes.',
  });
});

export default router;
