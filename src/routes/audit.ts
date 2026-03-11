import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

// GET /api/audit - View audit logs
// ADMIN: can view all audit logs
// BRANCH_MANAGER: can only view audit logs for their assigned branch
// Supports optional query params: action, entity, userId, startDate, endDate, limit, offset
router.get(
  '/',
  authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  async (req: Request, res: Response) => {
    try {
      const {
        action,
        entity,
        userId,
        startDate,
        endDate,
        limit = '50',
        offset = '0',
      } = req.query;

      // Build where clause
      const where: any = {};

      // Filter by action if provided
      if (action) {
        where.action = action as string;
      }

      // Filter by entity if provided
      if (entity) {
        where.entity = entity as string;
      }

      // Filter by userId if provided
      if (userId) {
        where.userId = userId as string;
      }

      // Filter by date range if provided
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate as string);
        }
        if (endDate) {
          where.createdAt.lte = new Date(endDate as string);
        }
      }

      // Apply branch visibility filter
      // ADMIN can see all logs, BRANCH_MANAGER can only see logs for their branch
      if (req.user?.role === 'BRANCH_MANAGER') {
        if (!req.user.branchId) {
          res.status(403).json({
            success: false,
            error: 'Branch context not available for BRANCH_MANAGER',
          });
          return;
        }
        where.branchId = req.user.branchId;
      }
      // ADMIN role: no branch filter applied (can see all logs)

      // Parse pagination
      const limitNum = parseInt(limit as string, 10);
      const offsetNum = parseInt(offset as string, 10);

      // Fetch audit logs with pagination
      const [auditLogs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: Math.min(limitNum, 100), // Cap at 100 to prevent abuse
          skip: offsetNum,
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          auditLogs,
          pagination: {
            total,
            limit: Math.min(limitNum, 100),
            offset: offsetNum,
            hasMore: offsetNum + Math.min(limitNum, 100) < total,
          },
        },
      });
    } catch (error) {
      console.error('Audit log retrieval error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve audit logs',
      });
    }
  }
);

// GET /api/audit/export - Export all audit logs as CSV (ADMIN only)
router.get(
  '/export',
  authMiddleware,
  roleMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const auditLogs = await prisma.auditLog.findMany({
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // CSV header
      const headers = [
        'id',
        'action',
        'entity',
        'entityId',
        'branchId',
        'userId',
        'userEmail',
        'userRole',
        'actorRole',
        'metadata',
        'ipAddress',
        'createdAt',
      ];

      // Escape CSV field
      const esc = (val: any) => {
        if (val === null || val === undefined) return '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      };

      const rows = auditLogs.map((log) =>
        [
          esc(log.id),
          esc(log.action),
          esc(log.entity),
          esc(log.entityId),
          esc(log.branchId),
          esc(log.userId),
          esc(log.user?.email),
          esc(log.user?.role),
          esc((log as any).actorRole),
          esc(log.metadata),
          esc(log.ipAddress),
          esc(log.createdAt.toISOString()),
        ].join(',')
      );

      const csv = [headers.join(','), ...rows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
      res.send(csv);
    } catch (error) {
      console.error('Audit CSV export error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export audit logs',
      });
    }
  }
);

export default router;
