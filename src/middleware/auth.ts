import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { JwtPayload } from '../types/index.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload & {
        branchId?: string;
        staffId?: string;
        customerId?: string;
      };
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';
const prisma = new PrismaClient();

/**
 * Authentication middleware - validates JWT token and enriches request with user context
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  return (async () => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'No token provided',
      });
      return;
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      req.user = decoded;

      // Enrich with profile-specific IDs
      if (decoded.role === 'ADMIN') {
        // Admin has no branch/staff/customer restrictions
        next();
        return;
      }

      // Load profile to get branchId for BRANCH_MANAGER/STAFF or customerId for CUSTOMER
      if (decoded.role === 'BRANCH_MANAGER' || decoded.role === 'STAFF') {
        const staff = await prisma.staff.findUnique({
          where: { userId: decoded.userId },
          select: { id: true, branchId: true, isManager: true },
        });
        if (staff) {
          req.user.branchId = staff.branchId;
          req.user.staffId = staff.id;
        }
      } else if (decoded.role === 'CUSTOMER') {
        const customer = await prisma.customer.findUnique({
          where: { userId: decoded.userId },
          select: { id: true },
        });
        if (customer) {
          req.user.customerId = customer.id;
        }
      }

      next();
    } catch (error) {
      res.status(401).json({
        success: false,
        error: 'Invalid token',
      });
      return;
    }
  })();
}

/**
 * Role-based access control middleware
 * @param allowedRoles - List of roles permitted to access this route
 */
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

/**
 * Branch-scoped access control middleware
 * Ensures user can only access resources within their branch (for BRANCH_MANAGER/STAFF)
 * ADMIN can access all branches
 * 
 * @param allowAdmin - Whether ADMIN role should be allowed (default: true)
 */
export function branchScopedMiddleware(allowAdmin: boolean = true) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    // ADMIN can access all branches
    if (req.user.role === 'ADMIN') {
      if (allowAdmin) {
        next();
        return;
      } else {
        res.status(403).json({
          success: false,
          error: 'Admin access not permitted for this operation',
        });
        return;
      }
    }

    // BRANCH_MANAGER and STAFF can only access their own branch
    if (req.user.role === 'BRANCH_MANAGER' || req.user.role === 'STAFF') {
      if (!req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Branch context not available',
        });
        return;
      }

      // Check if the requested resource belongs to user's branch
      const requestedBranchId = req.params.branchId || req.body.branchId;
      
      if (requestedBranchId && requestedBranchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Cannot access resources outside your branch',
        });
        return;
      }

      // Inject branchId into params/body if not provided (for list operations)
      if (!requestedBranchId) {
        req.query = req.query || {};
        (req.query as any).branchId = req.user.branchId;
      }

      next();
      return;
    }

    // CUSTOMER cannot access branch-scoped admin/staff routes
    res.status(403).json({
      success: false,
      error: 'Insufficient permissions for branch operations',
    });
  };
}

/**
 * Resource ownership middleware
 * Ensures user can only access/modify their own resources
 * 
 * @param resourceType - Type of resource ('appointment', 'customer', etc.)
 * @param idParam - Parameter name containing resource ID (default: 'id')
 */
export function ownershipMiddleware(resourceType: string, idParam: string = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    // ADMIN can access all resources
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
      // Check ownership based on resource type
      if (resourceType === 'appointment') {
        const appointment = await prisma.appointment.findUnique({
          where: { id: resourceId },
          select: { customerId: true },
        });

        if (!appointment) {
          res.status(404).json({
            success: false,
            error: 'Appointment not found',
          });
          return;
        }

        // CUSTOMER can only access their own appointments
        if (req.user.role === 'CUSTOMER') {
          if (!req.user.customerId || appointment.customerId !== req.user.customerId) {
            res.status(403).json({
              success: false,
              error: 'Access denied: You can only access your own appointments',
            });
            return;
          }
        }

        // BRANCH_MANAGER/STAFF can access appointments at their branch
        if (req.user.role === 'BRANCH_MANAGER' || req.user.role === 'STAFF') {
          const apptWithBranch = await prisma.appointment.findUnique({
            where: { id: resourceId },
            select: { branchId: true },
          });
          if (apptWithBranch && apptWithBranch.branchId !== req.user.branchId) {
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

/**
 * Optional auth middleware - doesn't fail if no token, but enriches request if valid
 */
export function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  return (async () => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      req.user = decoded;

      // Enrich with profile-specific IDs
      if (decoded.role === 'BRANCH_MANAGER' || decoded.role === 'STAFF') {
        const staff = await prisma.staff.findUnique({
          where: { userId: decoded.userId },
          select: { id: true, branchId: true },
        });
        if (staff) {
          req.user.branchId = staff.branchId;
          req.user.staffId = staff.id;
        }
      } else if (decoded.role === 'CUSTOMER') {
        const customer = await prisma.customer.findUnique({
          where: { userId: decoded.userId },
          select: { id: true },
        });
        if (customer) {
          req.user.customerId = customer.id;
        }
      }
    } catch (error) {
      // Invalid token, but we continue without auth
    }

    next();
  })();
}
