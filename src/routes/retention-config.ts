import { PrismaClient } from '@prisma/client';
import { Request, Response, Router } from 'express';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { updateRetentionConfigSchema } from '../types/index.js';
import { logAuditFromRequest } from '../utils/audit-logger.js';
import { getEffectiveRetentionConfigs } from '../utils/retention-config.js';

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware, roleMiddleware('ADMIN'));

router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
    const retentionConfigs = await getEffectiveRetentionConfigs(prisma);
    const data = branchId
      ? retentionConfigs.find((config) => config.branchId === branchId) ?? null
      : retentionConfigs;

    if (branchId && !data) {
      res.status(404).json({
        success: false,
        error: 'Branch not found',
      });
      return;
    }

    await logAuditFromRequest(
      req,
      'RETENTION_CONFIG_VIEWED',
      'RetentionConfig',
      branchId,
      {
        branchId,
      },
      branchId ?? null
    );

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error retrieving retention configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

router.put('/', async (req: Request, res: Response) => {
  try {
    const validation = updateRetentionConfigSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.errors,
      });
      return;
    }

    const { branchId, retentionDays } = validation.data;
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, name: true, code: true },
    });

    if (!branch) {
      res.status(404).json({
        success: false,
        error: 'Branch not found',
      });
      return;
    }

    const retentionConfig = await prisma.retentionConfig.upsert({
      where: { branchId },
      update: {
        retentionDays,
        updatedBy: req.user!.userId,
      },
      create: {
        branchId,
        retentionDays,
        updatedBy: req.user!.userId,
      },
      select: {
        id: true,
        branchId: true,
        retentionDays: true,
        updatedBy: true,
        updatedAt: true,
      },
    });

    await logAuditFromRequest(
      req,
      'RETENTION_CONFIG_UPDATED',
      'RetentionConfig',
      retentionConfig.id,
      {
        branchId,
        retentionDays,
        branchCode: branch.code,
        branchName: branch.name,
      },
      branchId
    );

    res.json({
      success: true,
      data: {
        ...retentionConfig,
        branch,
      },
      message: 'Retention configuration updated successfully',
    });
  } catch (error) {
    console.error('Error updating retention configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
