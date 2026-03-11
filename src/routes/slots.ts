import { Router, Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { authMiddleware, roleMiddleware, branchScopedMiddleware } from '../middleware/auth.js';
import { assignStaffToSlotSchema, createSlotBulkSchema, createSlotSchema, updateSlotSchema } from '../types/index.js';
import { createAuditLog, logAuditFromRequest, getIpAddressFromRequest } from '../utils/audit-logger.js';
import { getEffectiveRetentionConfigs } from '../utils/retention-config.js';

const router = Router();
const prisma = new PrismaClient();
const SLOT_BOOKING_LIMIT = 1;

const slotListSelect = {
  id: true,
  startTime: true,
  endTime: true,
  capacity: true,
  bookedCount: true,
  isActive: true,
  deletedAt: true,
  createdAt: true,
  branch: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
  serviceType: {
    select: {
      id: true,
      name: true,
      code: true,
      duration: true,
    },
  },
  _count: {
    select: {
      assignments: true,
      appointments: true,
    },
  },
};

function buildSlotListWhereClause(
  query: Request['query'],
  options: {
    branchId?: string;
    allowDeleted?: boolean;
    forceAvailable?: boolean;
  } = {}
) {
  const { branchId, serviceTypeId, startDate, endDate, isActive, available } = query;
  const whereClause: any = {};

  if (options.branchId) {
    whereClause.branchId = options.branchId;
  } else if (branchId) {
    whereClause.branchId = branchId as string;
  }

  if (serviceTypeId) {
    whereClause.serviceTypeId = serviceTypeId as string;
  }

  if (isActive !== undefined) {
    whereClause.isActive = isActive === 'true';
  }

  if (startDate || endDate) {
    whereClause.startTime = {};

    if (startDate) {
      whereClause.startTime.gte = new Date(startDate as string);
    }

    if (endDate) {
      whereClause.startTime.lte = new Date(endDate as string);
    }
  }

  if (!options.allowDeleted) {
    whereClause.deletedAt = null;
  }

  if (available === 'true' || options.forceAvailable) {
    whereClause.bookedCount = { lt: SLOT_BOOKING_LIMIT };
    whereClause.isActive = true;
  }

  return whereClause;
}

type SlotCreatePayload = {
  branchId: string;
  serviceTypeId: string;
  startTime: string;
  endTime: string;
  capacity?: 1;
};

async function validateSlotCreatePayload(req: Request, data: SlotCreatePayload) {
  if (req.user?.role === 'BRANCH_MANAGER' && req.user?.branchId !== data.branchId) {
    return {
      ok: false as const,
      status: 403,
      error: 'Access denied: Can only create slots in your assigned branch',
    };
  }

  const serviceType = await prisma.serviceType.findUnique({
    where: { id: data.serviceTypeId },
    select: { id: true, branchId: true },
  });

  if (!serviceType) {
    return {
      ok: false as const,
      status: 400,
      error: 'Service type not found',
    };
  }

  if (serviceType.branchId !== data.branchId) {
    return {
      ok: false as const,
      status: 400,
      error: 'Service type does not belong to the specified branch',
    };
  }

  const startTime = new Date(data.startTime);
  const endTime = new Date(data.endTime);

  if (endTime <= startTime) {
    return {
      ok: false as const,
      status: 400,
      error: 'End time must be after start time',
    };
  }

  return {
    ok: true as const,
    startTime,
    endTime,
  };
}

async function createSlots(req: Request, res: Response, payload: SlotCreatePayload[], isBulkRequest: boolean) {
  const createdSlots = [];

  for (let index = 0; index < payload.length; index += 1) {
    const data = payload[index];
    const validation = await validateSlotCreatePayload(req, data);

    if (!validation.ok) {
      res.status(validation.status).json({
        success: false,
        error: validation.error,
        ...(isBulkRequest ? { details: [{ index }] } : {}),
      });
      return;
    }

    const slot = await prisma.slot.create({
      data: {
        branchId: data.branchId,
        serviceTypeId: data.serviceTypeId,
        startTime: validation.startTime,
        endTime: validation.endTime,
        capacity: SLOT_BOOKING_LIMIT,
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        bookedCount: true,
        isActive: true,
        createdAt: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        serviceType: {
          select: {
            id: true,
            name: true,
            code: true,
            duration: true,
          },
        },
      },
    });

    await logAuditFromRequest(
      req,
      'SLOT_CREATED',
      'Slot',
      slot.id,
      {
        branchId: data.branchId,
        serviceTypeId: data.serviceTypeId,
        startTime: validation.startTime.toISOString(),
        endTime: validation.endTime.toISOString(),
        capacity: SLOT_BOOKING_LIMIT,
      }
    );

    createdSlots.push(slot);
  }

  res.status(201).json({
    success: true,
    data: isBulkRequest ? createdSlots : createdSlots[0],
    message: isBulkRequest ? `Created ${createdSlots.length} time slots successfully` : 'Time slot created successfully',
  });
}

async function getSlotAssignmentContext(slotId: string) {
  return prisma.slot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      branchId: true,
      serviceTypeId: true,
      deletedAt: true,
      branch: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
      serviceType: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
    },
  });
}

function assertCanManageSlotAssignments(req: Request, slotBranchId: string, action: 'assign' | 'unassign') {
  if (req.user?.role === 'BRANCH_MANAGER' && req.user.branchId !== slotBranchId) {
    const verb = action === 'assign' ? 'assign staff to' : 'unassign staff from';

    return {
      allowed: false,
      message: `Access denied: Can only ${verb} slots in your assigned branch`,
    };
  }

  return { allowed: true as const };
}

// GET /api/slots - Public list of bookable slots. Never returns soft-deleted rows.
router.get('/', async (req: Request, res: Response) => {
  try {
    const whereClause = buildSlotListWhereClause(req.query, {
      forceAvailable: req.query.available === 'true',
    });

    const slots = await prisma.slot.findMany({
      where: whereClause,
      select: slotListSelect,
      orderBy: { startTime: 'asc' },
      take: 100,
    });

    res.json({
      success: true,
      data: slots,
    });
  } catch (error) {
    console.error('Error listing public slots:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// GET /api/slots/branch-view - Authenticated internal listing for ADMIN/BRANCH_MANAGER/STAFF.
// Managers and staff remain branch-scoped and deleted slots stay hidden.
router.get('/branch-view', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER', 'STAFF'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
      const whereClause = buildSlotListWhereClause(req.query, { branchId });

      const slots = await prisma.slot.findMany({
        where: whereClause,
        select: slotListSelect,
        orderBy: { startTime: 'asc' },
        take: 100,
      });

      res.json({
        success: true,
        data: slots,
      });
    } catch (error) {
      console.error('Error listing branch-scoped slots:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// GET /api/slots/admin-view - Admin-only listing. includeDeleted=true includes soft-deleted rows.
router.get('/admin-view', authMiddleware,
  roleMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const whereClause = buildSlotListWhereClause(req.query, {
        allowDeleted: req.query.includeDeleted === 'true',
      });

      const slots = await prisma.slot.findMany({
        where: whereClause,
        select: slotListSelect,
        orderBy: { startTime: 'asc' },
        take: 100,
      });

      res.json({
        success: true,
        data: slots,
      });
    } catch (error) {
      console.error('Error listing admin slots:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// POST /api/slots - Create time slot (ADMIN/BRANCH_MANAGER)
router.post('/', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const schema = Array.isArray(req.body) ? createSlotBulkSchema : createSlotSchema;
      const validation = schema.safeParse(req.body);

      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }

      const payload = (Array.isArray(validation.data) ? validation.data : [validation.data]) as SlotCreatePayload[];
      await createSlots(req, res, payload, Array.isArray(validation.data));
    } catch (error) {
      console.error('Error creating slot:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

router.post('/bulk', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const validation = createSlotBulkSchema.safeParse(req.body);

      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }

      await createSlots(req, res, validation.data as SlotCreatePayload[], true);
    } catch (error) {
      console.error('Error bulk creating slots:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// POST /api/slots/cleanup-retention - Permanently delete soft-deleted slots exceeding the DB-backed retention period (ADMIN only)
router.post('/cleanup-retention', authMiddleware,
  roleMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const now = new Date();
      const ipAddress = getIpAddressFromRequest(req);
      const cleanupResult = await prisma.$transaction(async (tx) => {
        const retentionConfigs = await getEffectiveRetentionConfigs(tx);
        const deletionDetails: Array<{
          id: string;
          branchId: string;
          branchCode: string;
          retentionDays: number;
          serviceTypeId: string;
          startTime: string;
          deletedAt: string;
          appointmentCount: number;
          assignmentCount: number;
        }> = [];

        for (const config of retentionConfigs) {
          const cutoffDate = new Date(now);
          cutoffDate.setDate(cutoffDate.getDate() - config.retentionDays);

          const branchSlots = await tx.slot.findMany({
            where: {
              branchId: config.branchId,
              deletedAt: {
                lte: cutoffDate,
              },
            },
            select: {
              id: true,
              branchId: true,
              serviceTypeId: true,
              startTime: true,
              deletedAt: true,
              _count: {
                select: {
                  appointments: true,
                  assignments: true,
                },
              },
            },
            orderBy: [
              { deletedAt: 'asc' },
              { id: 'asc' },
            ],
          });

          for (const slot of branchSlots) {
            await tx.slotAssignment.deleteMany({
              where: { slotId: slot.id },
            });

            await tx.appointment.updateMany({
              where: { slotId: slot.id },
              data: { slotId: null },
            });

            await createAuditLog(
              tx,
              req.user?.userId,
              'SLOT_HARD_DELETED',
              'Slot',
              slot.id,
              {
                branchId: slot.branchId,
                branchCode: config.branchCode,
                retentionDays: config.retentionDays,
                serviceTypeId: slot.serviceTypeId,
                startTime: slot.startTime.toISOString(),
                deletedAt: slot.deletedAt!.toISOString(),
                hardDeletedAt: now.toISOString(),
                appointmentCount: slot._count.appointments,
                assignmentCount: slot._count.assignments,
              },
              ipAddress,
              slot.branchId,
              req.user?.role
            );

            await tx.slot.delete({
              where: { id: slot.id },
            });

            deletionDetails.push({
              id: slot.id,
              branchId: slot.branchId,
              branchCode: config.branchCode,
              retentionDays: config.retentionDays,
              serviceTypeId: slot.serviceTypeId,
              startTime: slot.startTime.toISOString(),
              deletedAt: slot.deletedAt!.toISOString(),
              appointmentCount: slot._count.appointments,
              assignmentCount: slot._count.assignments,
            });
          }
        }

        await createAuditLog(
          tx,
          req.user?.userId,
          'RETENTION_CLEANUP',
          'Slot',
          undefined,
          {
            deletedCount: deletionDetails.length,
            deletedSlots: deletionDetails,
            retentionConfigs: retentionConfigs.map((config) => ({
              branchId: config.branchId,
              retentionDays: config.retentionDays,
            })),
          },
          ipAddress,
          undefined,
          req.user?.role
        );

        return {
          deletedCount: deletionDetails.length,
          deletedSlots: deletionDetails,
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });

      res.json({
        success: true,
        message:
          cleanupResult.deletedCount === 0
            ? 'No soft-deleted slots found exceeding configured retention periods'
            : `Permanently deleted ${cleanupResult.deletedCount} soft-deleted slot(s) exceeding configured retention periods`,
        data: {
          deletedCount: cleanupResult.deletedCount,
          deletedSlots: cleanupResult.deletedSlots,
        },
      });
    } catch (error: any) {
      console.error('Error performing retention cleanup:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error during retention cleanup',
      });
    }
  }
);

// GET /api/slots/retention-preview - Preview which soft-deleted slots would be deleted (ADMIN only)
router.get('/retention-preview', authMiddleware,
  roleMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const retentionConfigs = await getEffectiveRetentionConfigs(prisma);
      const now = new Date();
      const slotsToBeDeleted = [];

      for (const config of retentionConfigs) {
        const cutoffDate = new Date(now);
        cutoffDate.setDate(cutoffDate.getDate() - config.retentionDays);

        const branchSlots = await prisma.slot.findMany({
          where: {
            branchId: config.branchId,
            deletedAt: {
              lte: cutoffDate,
            },
          },
          select: {
            id: true,
            branchId: true,
            serviceTypeId: true,
            startTime: true,
            endTime: true,
            capacity: true,
            deletedAt: true,
            createdAt: true,
            branch: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            serviceType: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
          orderBy: { deletedAt: 'asc' },
        });

        slotsToBeDeleted.push(
          ...branchSlots.map((slot) => ({
            ...slot,
            retentionDays: config.retentionDays,
            cutoffDate: cutoffDate.toISOString(),
          }))
        );
      }

      res.json({
        success: true,
        message: `Found ${slotsToBeDeleted.length} soft-deleted slot(s) exceeding configured retention periods`,
        data: {
          wouldDeleteCount: slotsToBeDeleted.length,
          slotsToBeDeleted,
        },
      });
    } catch (error: any) {
      console.error('Error previewing retention cleanup:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error during retention preview',
      });
    }
  }
);

// POST /api/slots/:id/assign-staff - Explicitly assign staff to a slot (slot-level only)
router.post('/:id/assign-staff', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  async (req: Request, res: Response) => {
    try {
      const slotId = String(req.params.id);
      const validation = assignStaffToSlotSchema.safeParse(req.body);

      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }

      const slot = await getSlotAssignmentContext(slotId);

      if (!slot) {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
        });
        return;
      }

      const permission = assertCanManageSlotAssignments(req, slot.branchId, 'assign');
      if (!permission.allowed) {
        res.status(403).json({
          success: false,
          error: permission.message,
        });
        return;
      }

      if (slot.deletedAt) {
        res.status(400).json({
          success: false,
          error: 'Cannot assign staff to a soft-deleted slot',
        });
        return;
      }

      const staff = await prisma.staff.findUnique({
        where: { id: validation.data.staffId },
        select: {
          id: true,
          branchId: true,
          position: true,
          employeeId: true,
          isManager: true,
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
      });

      if (!staff) {
        res.status(404).json({
          success: false,
          error: 'Staff member not found',
        });
        return;
      }

      if (staff.branchId !== slot.branchId) {
        res.status(400).json({
          success: false,
          error: 'Staff member must belong to the same branch as the slot',
        });
        return;
      }

      const existingAssignment = await prisma.slotAssignment.findUnique({
        where: {
          slotId_staffId: {
            slotId,
            staffId: staff.id,
          },
        },
        select: {
          id: true,
          createdAt: true,
        },
      });

      if (existingAssignment) {
        res.json({
          success: true,
          data: {
            id: existingAssignment.id,
            slotId,
            staffId: staff.id,
            assignmentScope: 'slot',
            createdAt: existingAssignment.createdAt,
            slot: {
              id: slot.id,
              branch: slot.branch,
              serviceType: slot.serviceType,
            },
            staff: {
              id: staff.id,
              position: staff.position,
              employeeId: staff.employeeId,
              isManager: staff.isManager,
              user: staff.user,
            },
          },
          message: 'Staff member is already assigned to this slot',
        });
        return;
      }

      const assignment = await prisma.slotAssignment.create({
        data: {
          slotId,
          staffId: staff.id,
        },
        select: {
          id: true,
          slotId: true,
          staffId: true,
          createdAt: true,
        },
      });

      await logAuditFromRequest(
        req,
        'STAFF_ASSIGNED',
        'SlotAssignment',
        assignment.id,
        {
          branchId: slot.branchId,
          slotId: slot.id,
          serviceTypeId: slot.serviceTypeId,
          staffId: staff.id,
          staffUserId: staff.user.id,
          staffEmail: staff.user.email,
          assignmentScope: 'slot',
        }
      );

      res.status(201).json({
        success: true,
        data: {
          ...assignment,
          assignmentScope: 'slot',
          slot: {
            id: slot.id,
            branch: slot.branch,
            serviceType: slot.serviceType,
          },
          staff: {
            id: staff.id,
            position: staff.position,
            employeeId: staff.employeeId,
            isManager: staff.isManager,
            user: staff.user,
          },
        },
        message: 'Staff assigned to slot successfully',
      });
    } catch (error) {
      console.error('Error assigning staff to slot:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// DELETE /api/slots/:id/assign-staff/:staffId - Explicitly remove staff assignment from a slot (slot-level only)
router.delete('/:id/assign-staff/:staffId', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  async (req: Request, res: Response) => {
    try {
      const slotId = String(req.params.id);
      const staffId = String(req.params.staffId);
      const slot = await getSlotAssignmentContext(slotId);

      if (!slot) {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
        });
        return;
      }

      const permission = assertCanManageSlotAssignments(req, slot.branchId, 'unassign');
      if (!permission.allowed) {
        res.status(403).json({
          success: false,
          error: permission.message,
        });
        return;
      }

      const existingAssignment = await prisma.slotAssignment.findUnique({
        where: {
          slotId_staffId: {
            slotId,
            staffId,
          },
        },
        select: {
          id: true,
          slotId: true,
          staffId: true,
          createdAt: true,
          staff: {
            select: {
              id: true,
              position: true,
              employeeId: true,
              isManager: true,
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
          },
        },
      });

      if (!existingAssignment) {
        res.json({
          success: true,
          data: {
            slotId,
            staffId,
            assignmentScope: 'slot',
            removed: false,
          },
          message: 'Staff member was not assigned to this slot',
        });
        return;
      }

      await prisma.slotAssignment.delete({
        where: {
          slotId_staffId: {
            slotId,
            staffId,
          },
        },
      });

      await logAuditFromRequest(
        req,
        'STAFF_UNASSIGNED',
        'SlotAssignment',
        existingAssignment.id,
        {
          branchId: slot.branchId,
          slotId: slot.id,
          serviceTypeId: slot.serviceTypeId,
          staffId: existingAssignment.staffId,
          staffUserId: existingAssignment.staff.user.id,
          staffEmail: existingAssignment.staff.user.email,
          assignmentScope: 'slot',
        }
      );

      res.json({
        success: true,
        data: {
          id: existingAssignment.id,
          slotId: existingAssignment.slotId,
          staffId: existingAssignment.staffId,
          createdAt: existingAssignment.createdAt,
          removed: true,
          assignmentScope: 'slot',
          slot: {
            id: slot.id,
            branch: slot.branch,
            serviceType: slot.serviceType,
          },
          staff: {
            id: existingAssignment.staff.id,
            position: existingAssignment.staff.position,
            employeeId: existingAssignment.staff.employeeId,
            isManager: existingAssignment.staff.isManager,
            user: existingAssignment.staff.user,
          },
        },
        message: 'Staff unassigned from slot successfully',
      });
    } catch (error) {
      console.error('Error unassigning staff from slot:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

// GET /api/slots/my-assignments - List slots assigned to the authenticated staff member
router.get('/my-assignments', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user?.staffId) {
      return res.status(403).json({
        success: false,
        error: 'Only staff members can view their assignments',
      });
    }

    const assignments = await prisma.slotAssignment.findMany({
      where: { staffId: req.user.staffId },
      include: {
        slot: {
          include: {
            branch: { select: { id: true, name: true, code: true } },
            serviceType: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });

    const slots = assignments.map((a: any) => ({
      assignmentId: a.id,
      slotId: a.slot.id,
      dayOfWeek: a.slot.dayOfWeek,
      startTime: a.slot.startTime,
      endTime: a.slot.endTime,
      isActive: a.slot.isActive,
      branch: a.slot.branch,
      serviceType: a.slot.serviceType,
      assignedAt: a.createdAt,
    }));

    return res.json({ success: true, data: slots });
  } catch (error) {
    console.error('Error fetching staff assignments:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch assignments' });
  }
});

// GET /api/slots/:id - Get slot details
// Excludes soft-deleted slots by default. ADMIN can use ?includeDeleted=true to view deleted slots.
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { includeDeleted } = req.query;
    
    // Check if user can view soft-deleted slots (ADMIN only)
    const canViewDeleted = req.user?.role === 'ADMIN' && includeDeleted === 'true';
    
    // Build where clause to exclude soft-deleted unless admin requests them
    const whereClause: any = { id };
    if (!canViewDeleted) {
      whereClause.deletedAt = null;
    }
    
    const slot = await prisma.slot.findFirst({
      where: whereClause,
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        bookedCount: true,
        isActive: true,
        deletedAt: true,
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
        serviceType: {
          select: {
            id: true,
            name: true,
            code: true,
            duration: true,
            description: true,
          },
        },
        assignments: {
          select: {
            id: true,
            staff: {
              select: {
                id: true,
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
                position: true,
              },
            },
          },
        },
        appointments: {
          select: {
            id: true,
            status: true,
            customer: {
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
        },
        _count: {
          select: {
            assignments: true,
            appointments: true,
          },
        },
      },
    });
    
    if (!slot) {
      res.status(404).json({
        success: false,
        error: 'Time slot not found',
      });
      return;
    }
    
    // Check access: BRANCH_MANAGER/STAFF can only view slots in their branch
    if (req.user?.role === 'BRANCH_MANAGER' || req.user?.role === 'STAFF') {
      if (req.user?.branchId && slot.branch.id !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Cannot view slots outside your branch',
        });
        return;
      }
    }
    
    res.json({
      success: true,
      data: slot,
    });
  } catch (error) {
    console.error('Error getting slot:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// PATCH /api/slots/:id - Update slot (ADMIN/BRANCH_MANAGER)
router.patch('/:id', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const validation = updateSlotSchema.safeParse(req.body);
      
      if (!validation.success) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.error.errors,
        });
        return;
      }
      
      const existingSlot = await prisma.slot.findUnique({
        where: { id },
        select: { branchId: true, bookedCount: true, capacity: true },
      });
      
      if (!existingSlot) {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
        });
        return;
      }
      
      // BRANCH_MANAGER can only update slots in their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && existingSlot.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only update slots in your assigned branch',
        });
        return;
      }
      
      const updateData = validation.data;
      
      if (updateData.capacity !== undefined) {
        updateData.capacity = SLOT_BOOKING_LIMIT;
      }
      
      // Validate service type if being updated
      if (updateData.serviceTypeId) {
        const serviceType = await prisma.serviceType.findUnique({
          where: { id: updateData.serviceTypeId },
          select: { id: true, branchId: true },
        });
        
        if (!serviceType) {
          res.status(400).json({
            success: false,
            error: 'Service type not found',
          });
          return;
        }
        
        if (serviceType.branchId !== existingSlot.branchId) {
          res.status(400).json({
            success: false,
            error: 'Service type does not belong to this branch',
          });
          return;
        }
      }
      
      // Validate time range if both times are being updated
      if (updateData.startTime && updateData.endTime) {
        const startTime = new Date(updateData.startTime);
        const endTime = new Date(updateData.endTime);
        
        if (endTime <= startTime) {
          res.status(400).json({
            success: false,
            error: 'End time must be after start time',
          });
          return;
        }
      }
      
      const slot = await prisma.slot.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          startTime: true,
          endTime: true,
          capacity: true,
          bookedCount: true,
          isActive: true,
          updatedAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          serviceType: {
            select: {
              id: true,
              name: true,
              code: true,
              duration: true,
            },
          },
        },
      });
      
      // Audit log: slot updated
      await logAuditFromRequest(
        req,
        'SLOT_UPDATED',
        'Slot',
        id,
        {
          branchId: existingSlot.branchId,
          changes: updateData,
          previousCapacity: existingSlot.capacity,
        }
      );
      
      res.json({
        success: true,
        data: slot,
        message: 'Time slot updated successfully',
      });
    } catch (error: any) {
      console.error('Error updating slot:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
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

// DELETE /api/slots/:id - Soft delete slot (ADMIN/BRANCH_MANAGER)
// Sets deletedAt timestamp instead of hard deleting. Can be restored by clearing deletedAt.
router.delete('/:id', authMiddleware,
  roleMiddleware('ADMIN', 'BRANCH_MANAGER'),
  branchScopedMiddleware(true),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      
      const existingSlot = await prisma.slot.findUnique({
        where: { id },
        select: { branchId: true, bookedCount: true, appointments: true, deletedAt: true },
      });
      
      if (!existingSlot) {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
        });
        return;
      }
      
      // BRANCH_MANAGER can only delete slots in their own branch
      if (req.user?.role === 'BRANCH_MANAGER' && existingSlot.branchId !== req.user.branchId) {
        res.status(403).json({
          success: false,
          error: 'Access denied: Can only delete slots in your assigned branch',
        });
        return;
      }
      
      // Cannot soft-delete slot with existing appointments (same as hard delete)
      if (existingSlot.bookedCount > 0) {
        res.status(400).json({
          success: false,
          error: 'Cannot delete time slot with existing appointments',
        });
        return;
      }
      
      // Soft delete: set deletedAt timestamp instead of deleting
      const slot = await prisma.slot.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          capacity: true,
          bookedCount: true,
          isActive: true,
          deletedAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          serviceType: {
            select: {
              id: true,
              name: true,
              code: true,
              duration: true,
            },
          },
        },
      });
      
      // Audit log: slot deleted (soft delete)
      await logAuditFromRequest(
        req,
        'SLOT_DELETED',
        'Slot',
        id,
        {
          branchId: existingSlot.branchId,
          bookedCount: existingSlot.bookedCount,
          softDelete: true,
        }
      );
      
      res.json({
        success: true,
        message: 'Time slot soft deleted successfully',
        data: slot,
      });
    } catch (error: any) {
      console.error('Error soft deleting slot:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
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

// POST /api/slots/:id/restore - Restore a soft-deleted slot (ADMIN only)
// Clears deletedAt to make the slot visible again
router.post('/:id/restore', authMiddleware,
  roleMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      
      const existingSlot = await prisma.slot.findUnique({
        where: { id },
        select: { id: true, deletedAt: true, branchId: true },
      });
      
      if (!existingSlot) {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
        });
        return;
      }
      
      // Can only restore if it's actually soft-deleted
      if (!existingSlot.deletedAt) {
        res.status(400).json({
          success: false,
          error: 'Slot is not soft deleted',
        });
        return;
      }
      
      const slot = await prisma.slot.update({
        where: { id },
        data: { deletedAt: null },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          capacity: true,
          bookedCount: true,
          isActive: true,
          deletedAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          serviceType: {
            select: {
              id: true,
              name: true,
              code: true,
              duration: true,
            },
          },
        },
      });
      
      // Audit log: slot restored
      await logAuditFromRequest(
        req,
        'SLOT_RESTORED',
        'Slot',
        id,
        {
          branchId: existingSlot.branchId,
          restoredAt: new Date().toISOString(),
        }
      );
      
      res.json({
        success: true,
        message: 'Time slot restored successfully',
        data: slot,
      });
    } catch (error: any) {
      console.error('Error restoring slot:', error);
      if (error.code === 'P2025') {
        res.status(404).json({
          success: false,
          error: 'Time slot not found',
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
