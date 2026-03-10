import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { AuthenticatedUser } from '../types/index.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const prisma = new PrismaClient();

export function parseBasicAuthHeader(authorization?: string): { email: string; password: string } | null {
  if (!authorization || !authorization.startsWith('Basic ')) {
    return null;
  }

  const encodedCredentials = authorization.slice(6).trim();
  if (!encodedCredentials) {
    return null;
  }

  try {
    const decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString('utf8');
    const separatorIndex = decodedCredentials.indexOf(':');

    if (separatorIndex <= 0) {
      return null;
    }

    const email = decodedCredentials.slice(0, separatorIndex).trim();
    const password = decodedCredentials.slice(separatorIndex + 1);

    if (!email || !password) {
      return null;
    }

    return { email, password };
  } catch {
    return null;
  }
}

export async function authenticateBasicCredentials(
  credentials: { email: string; password: string }
): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
    where: { email: credentials.email },
    include: {
      staffProfile: {
        select: {
          id: true,
          branchId: true,
        },
      },
      customerProfile: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  const isValidPassword = await bcrypt.compare(credentials.password, user.password);
  if (!isValidPassword) {
    return null;
  }

  const authenticatedUser: AuthenticatedUser = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  if (user.role === 'BRANCH_MANAGER' || user.role === 'STAFF') {
    if (!user.staffProfile) {
      return null;
    }

    authenticatedUser.branchId = user.staffProfile.branchId;
    authenticatedUser.staffId = user.staffProfile.id;
  }

  if (user.role === 'CUSTOMER') {
    if (!user.customerProfile) {
      return null;
    }

    authenticatedUser.customerId = user.customerProfile.id;
  }

  return authenticatedUser;
}

async function authenticateRequest(req: Request): Promise<AuthenticatedUser | null> {
  const credentials = parseBasicAuthHeader(req.headers.authorization);
  if (!credentials) {
    return null;
  }

  return authenticateBasicCredentials(credentials);
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  return (async () => {
    try {
      const authenticatedUser = await authenticateRequest(req);

      if (!authenticatedUser) {
        res.setHeader('WWW-Authenticate', 'Basic realm="FlowCare"');
        res.status(401).json({
          success: false,
          error: 'Invalid or missing Basic Authentication credentials',
        });
        return;
      }

      req.user = authenticatedUser;
      next();
    } catch (error) {
      res.status(401).json({
        success: false,
        error: 'Authentication failed',
      });
    }
  })();
}

export function roleMiddleware(...allowedRoles: (string | string[])[]) {
  const flatRoles = allowedRoles.flat();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    if (!flatRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      });
      return;
    }

    next();
  };
}

export function branchScopedMiddleware(allowAdmin: boolean = true) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    if (req.user.role === 'ADMIN') {
      if (allowAdmin) {
        next();
        return;
      }

      res.status(403).json({
        success: false,
        error: 'Admin access not permitted for this operation',
      });
      return;
    }

    if (req.user.role === 'BRANCH_MANAGER' || req.user.role === 'STAFF') {
      if (!req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Branch context not available',
        });
        return;
      }

      const requestedBranchId =
        req.params.branchId ||
        req.body.branchId ||
        (typeof req.query.branchId === 'string' ? req.query.branchId : undefined);

      if (requestedBranchId && requestedBranchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Cannot access resources outside your branch',
        });
        return;
      }

      if (!requestedBranchId) {
        req.query = req.query || {};
        (req.query as any).branchId = req.user.branchId;
      }

      next();
      return;
    }

    res.status(403).json({
      success: false,
      error: 'Insufficient permissions for branch operations',
    });
  };
}

export function ownershipMiddleware(resourceType: string, idParam: string = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    if (req.user.role === 'ADMIN') {
      next();
      return;
    }

    const resourceId = req.params[idParam] || req.body[idParam];

    if (!resourceId) {
      res.status(400).json({
        success: false,
        error: 'Resource ID required',
      });
      return;
    }

    try {
      if (resourceType === 'appointment') {
        const appointment = await prisma.appointment.findUnique({
          where: { id: resourceId },
          select: { customerId: true, branchId: true },
        });

        if (!appointment) {
          res.status(404).json({
            success: false,
            error: 'Appointment not found',
          });
          return;
        }

        if (req.user.role === 'CUSTOMER') {
          if (!req.user.customerId || appointment.customerId !== req.user.customerId) {
            res.status(403).json({
              success: false,
              error: 'Access denied: You can only access your own appointments',
            });
            return;
          }
        }

        if (req.user.role === 'BRANCH_MANAGER' || req.user.role === 'STAFF') {
          if (appointment.branchId !== req.user.branchId) {
            res.status(403).json({
              success: false,
              error: 'Access denied: Cannot access appointments outside your branch',
            });
            return;
          }
        }
      }

      next();
    } catch (error) {
      console.error('Ownership check error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  };
}

export function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  return (async () => {
    if (!parseBasicAuthHeader(req.headers.authorization)) {
      next();
      return;
    }

    try {
      const authenticatedUser = await authenticateRequest(req);
      if (authenticatedUser) {
        req.user = authenticatedUser;
      }
    } catch {
      // Ignore invalid credentials for public endpoints.
    }

    next();
  })();
}
