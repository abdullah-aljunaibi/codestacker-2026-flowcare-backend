import { AppointmentStatus, Prisma, PrismaClient } from '@prisma/client';
import { Request, Response, Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { authMiddleware } from '../middleware/auth.js';
import { createAppointmentSchema, updateAppointmentSchema } from '../types/index.js';
import { logAuditFromRequest } from '../utils/audit-logger.js';

const router = Router();
const prisma = new PrismaClient();
const SLOT_BOOKING_LIMIT = 1;
const PRIVATE_APPOINTMENT_ATTACHMENT_DIR = path.join(process.cwd(), 'storage', 'private', 'appointment-attachments');
const APPOINTMENT_ATTACHMENT_MAX_SIZE = 5 * 1024 * 1024;
const APPOINTMENT_ATTACHMENT_MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};
const appointmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(PRIVATE_APPOINTMENT_ATTACHMENT_DIR, { recursive: true });
      cb(null, PRIVATE_APPOINTMENT_ATTACHMENT_DIR);
    },
    filename: (_req, file, cb) => {
      const allowedExtensions = APPOINTMENT_ATTACHMENT_MIME_TO_EXTENSIONS[file.mimetype];

      if (!allowedExtensions) {
        cb(new Error('Invalid attachment type. Only images and PDF files are allowed.'), '');
        return;
      }

      cb(null, `${randomUUID()}${allowedExtensions[0]}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowedExtensions = APPOINTMENT_ATTACHMENT_MIME_TO_EXTENSIONS[file.mimetype];
    const extension = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions || !allowedExtensions.includes(extension)) {
      cb(new Error('Invalid attachment type. Only images and PDF files are allowed.'), false);
      return;
    }

    cb(null, true);
  },
  limits: {
    fileSize: APPOINTMENT_ATTACHMENT_MAX_SIZE,
  },
});

const ACTIVE_SLOT_STATUSES: AppointmentStatus[] = ['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS'];
const NON_CANCELLED_STATUSES: AppointmentStatus[] = [
  'SCHEDULED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'NO_SHOW',
];
const APPOINTMENT_SELECT = {
  id: true,
  branchId: true,
  customerId: true,
  slotId: true,
  staffId: true,
  serviceTypeId: true,
  status: true,
  notes: true,
  attachmentUrl: true,
  checkedInAt: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  branch: {
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      city: true,
      phone: true,
    },
  },
  customer: {
    select: {
      id: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
  },
  slot: {
    select: {
      id: true,
      startTime: true,
      endTime: true,
      capacity: true,
      serviceType: {
        select: {
          id: true,
          name: true,
          code: true,
          duration: true,
          description: true,
        },
      },
    },
  },
  staff: {
    select: {
      id: true,
      position: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  },
} as const;

type AppointmentRecord = Prisma.AppointmentGetPayload<{ select: typeof APPOINTMENT_SELECT }>;

class ApiError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function normalizeStatusInput(status?: string): AppointmentStatus | undefined {
  if (!status) {
    return undefined;
  }

  switch (status) {
    case 'scheduled':
      return 'SCHEDULED';
    case 'checked-in':
      return 'CHECKED_IN';
    case 'in-progress':
      return 'IN_PROGRESS';
    case 'completed':
      return 'COMPLETED';
    case 'cancelled':
      return 'CANCELLED';
    case 'no-show':
      return 'NO_SHOW';
    case 'WAITING':
      return 'SCHEDULED';
    case 'SERVING':
      return 'IN_PROGRESS';
    case 'DONE':
      return 'COMPLETED';
    case 'SCHEDULED':
    case 'CHECKED_IN':
    case 'IN_PROGRESS':
    case 'COMPLETED':
    case 'CANCELLED':
    case 'NO_SHOW':
      return status;
    default:
      return undefined;
  }
}

function publicStatus(
  status: AppointmentStatus
): 'scheduled' | 'checked-in' | 'in-progress' | 'completed' | 'cancelled' | 'no-show' {
  switch (status) {
    case 'SCHEDULED':
      return 'scheduled';
    case 'CHECKED_IN':
      return 'checked-in';
    case 'IN_PROGRESS':
      return 'in-progress';
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    case 'NO_SHOW':
      return 'no-show';
  }
}

function serializeAppointment(appointment: NonNullable<AppointmentRecord>) {
  return {
    ...appointment,
    status: publicStatus(appointment.status),
  };
}

function sendError(res: Response, statusCode: number, message: string, details?: unknown) {
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(details !== undefined ? { details } : {}),
  });
}

function removeUploadedFile(filePath?: string) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  fs.unlinkSync(filePath);
}

function handleAppointmentUploadError(error: unknown, res: Response) {
  if (error instanceof multer.MulterError) {
    const multerError = error as multer.MulterError;

    if (multerError.code === 'LIMIT_FILE_SIZE') {
      sendError(
        res,
        400,
        `Attachment too large. Maximum file size is ${Math.floor(APPOINTMENT_ATTACHMENT_MAX_SIZE / (1024 * 1024))}MB.`
      );
      return true;
    }

    sendError(res, 400, `Upload error: ${multerError.message}`);
    return true;
  }

  if (error instanceof Error) {
    sendError(res, 400, error.message);
    return true;
  }

  return false;
}

function storeAppointmentAttachment(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    appointmentUpload.single('attachment')(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function getAppointmentOrThrow(id: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    select: APPOINTMENT_SELECT,
  });

  if (!appointment) {
    throw new ApiError(404, 'Appointment not found');
  }

  return appointment;
}

function assertAppointmentReadAccess(req: Request, appointment: NonNullable<AppointmentRecord>) {
  if (req.user?.role === 'CUSTOMER' && appointment.customerId !== req.user.customerId) {
    throw new ApiError(403, 'Access denied: You can only access your own appointments');
  }

  if (req.user?.role === 'BRANCH_MANAGER' && appointment.branchId !== req.user.branchId) {
    throw new ApiError(403, 'Access denied: Cannot access appointments outside your branch');
  }

  if (req.user?.role === 'STAFF' && appointment.staffId !== req.user.staffId) {
    throw new ApiError(403, 'Access denied: Staff can only access appointments assigned to them');
  }
}

function assertAppointmentCancellationAccess(req: Request, appointment: NonNullable<AppointmentRecord>) {
  assertAppointmentReadAccess(req, appointment);

  if (req.user?.role === 'STAFF' && appointment.staffId !== req.user.staffId) {
    throw new ApiError(403, 'Staff can only cancel appointments assigned to them');
  }
}

function assertAppointmentStatusAccess(req: Request, appointment: NonNullable<AppointmentRecord>) {
  if (req.user?.role === 'CUSTOMER') {
    throw new ApiError(403, 'Customers cannot update appointment status');
  }

  assertAppointmentReadAccess(req, appointment);

  if (req.user?.role === 'STAFF' && appointment.staffId !== req.user.staffId) {
    throw new ApiError(403, 'Staff can only update status for appointments assigned to them');
  }
}

function assertValidStatusTransition(currentStatus: AppointmentStatus, nextStatus: AppointmentStatus) {
  if (currentStatus === nextStatus) {
    return;
  }

  const validTransitions = new Map<AppointmentStatus, AppointmentStatus[]>([
    ['SCHEDULED', ['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']],
    ['CHECKED_IN', ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']],
    ['IN_PROGRESS', ['COMPLETED', 'CANCELLED']],
    ['COMPLETED', []],
    ['CANCELLED', []],
    ['NO_SHOW', []],
  ]);

  if (!validTransitions.get(currentStatus)?.includes(nextStatus)) {
    throw new ApiError(400, `Invalid appointment status transition: ${publicStatus(currentStatus)} -> ${publicStatus(nextStatus)}`);
  }
}

async function syncSlotBookedCount(tx: PrismaClient | Prisma.TransactionClient, slotId?: string | null) {
  if (!slotId) {
    return;
  }

  const activeCount = await tx.appointment.count({
    where: {
      slotId,
      status: { in: ACTIVE_SLOT_STATUSES },
    },
  });

  await tx.slot.updateMany({
    where: { id: slotId },
    data: { bookedCount: activeCount },
  });
}

async function resolveBookingStaffId(
  tx: PrismaClient | Prisma.TransactionClient,
  slot: {
    branchId: string;
    assignments: Array<{ staffId: string }>;
  },
  requestedStaffId?: string
) {
  if (!requestedStaffId) {
    return slot.assignments.length === 1 ? slot.assignments[0].staffId : null;
  }

  const staff = await tx.staff.findUnique({
    where: { id: requestedStaffId },
    select: { id: true, branchId: true },
  });

  if (!staff || staff.branchId !== slot.branchId) {
    throw new ApiError(400, 'Assigned staff member is invalid for the selected slot');
  }

  if (slot.assignments.length > 0 && !slot.assignments.some((assignment) => assignment.staffId === requestedStaffId)) {
    throw new ApiError(400, 'Assigned staff member is not assigned to the selected slot');
  }

  return staff.id;
}

router.use(authMiddleware);

router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, branchId, startDate, endDate } = req.query;
    const whereClause: Record<string, unknown> = {};

    if (req.user?.role === 'CUSTOMER') {
      if (!req.user.customerId) {
        throw new ApiError(403, 'Customer profile not found');
      }
      whereClause.customerId = req.user.customerId;
    } else if (req.user?.role === 'BRANCH_MANAGER') {
      whereClause.branchId = req.user.branchId;
    } else if (req.user?.role === 'STAFF') {
      whereClause.staffId = req.user.staffId;
    }

    const normalizedStatus = normalizeStatusInput(status as string | undefined);
    if (status && !normalizedStatus) {
      throw new ApiError(400, 'Invalid appointment status filter');
    }
    if (normalizedStatus) {
      whereClause.status = normalizedStatus;
    }

    if (branchId && req.user?.role === 'ADMIN') {
      whereClause.branchId = branchId;
    }

    if (startDate || endDate) {
      whereClause.slot = {
        startTime: {
          ...(startDate ? { gte: new Date(startDate as string) } : {}),
          ...(endDate ? { lte: new Date(endDate as string) } : {}),
        },
      };
    }

    const appointments = await prisma.appointment.findMany({
      where: whereClause,
      select: APPOINTMENT_SELECT,
      orderBy: [{ slot: { startTime: 'asc' } }, { createdAt: 'desc' }],
    });

    res.json({
      success: true,
      data: appointments.map((appointment) => serializeAppointment(appointment)),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(res, error.statusCode, error.message);
      return;
    }

    console.error('Error listing appointments:', error);
    sendError(res, 500, 'Internal server error');
  }
});

router.post('/', async (req: Request, res: Response) => {
  let shouldRemoveUploadedFile = false;

  try {
    await storeAppointmentAttachment(req, res);
    shouldRemoveUploadedFile = Boolean(req.file?.path);

    const validation = createAppointmentSchema.safeParse(req.body);
    if (!validation.success) {
      removeUploadedFile(req.file?.path);
      sendError(res, 400, 'Validation failed', validation.error.errors);
      return;
    }

    const data = validation.data;
    const customerId = req.user?.role === 'CUSTOMER' ? req.user.customerId : data.customerId;

    if (!customerId) {
      removeUploadedFile(req.file?.path);
      throw new ApiError(400, 'customerId is required');
    }

    if (req.user?.role === 'CUSTOMER' && customerId !== req.user.customerId) {
      removeUploadedFile(req.file?.path);
      throw new ApiError(403, 'Can only book appointments for yourself');
    }

    const attachmentUrl = req.file ? path.posix.join('appointment-attachments', req.file.filename) : data.attachmentUrl;

    const appointment = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });

      if (!customer) {
        throw new ApiError(404, 'Customer not found');
      }

      const slot = await tx.slot.findUnique({
        where: { id: data.slotId },
        select: {
          id: true,
          branchId: true,
          serviceTypeId: true,
          capacity: true,
          isActive: true,
          deletedAt: true,
          startTime: true,
          assignments: {
            select: {
              staffId: true,
            },
          },
        },
      });

      if (!slot) {
        throw new ApiError(404, 'Time slot not found');
      }

      if (!slot.isActive || slot.deletedAt) {
        throw new ApiError(400, 'This time slot is no longer available');
      }

      if (data.branchId && data.branchId !== slot.branchId) {
        throw new ApiError(400, 'Branch does not match the selected time slot');
      }

      if (data.serviceTypeId && data.serviceTypeId !== slot.serviceTypeId) {
        throw new ApiError(400, 'Service type does not match the selected time slot');
      }

      if (
        (req.user?.role === 'BRANCH_MANAGER' || req.user?.role === 'STAFF') &&
        req.user.branchId !== slot.branchId
      ) {
        throw new ApiError(403, 'Can only book appointments at your assigned branch');
      }

      const [activeCount, duplicate] = await Promise.all([
        tx.appointment.count({
          where: {
            slotId: slot.id,
            status: { in: ACTIVE_SLOT_STATUSES },
          },
        }),
        tx.appointment.findFirst({
          where: {
            slotId: slot.id,
            customerId,
            status: { in: NON_CANCELLED_STATUSES },
          },
          select: { id: true },
        }),
      ]);

      if (activeCount >= SLOT_BOOKING_LIMIT) {
        throw new ApiError(409, 'Time slot already has a booking');
      }

      if (duplicate) {
        throw new ApiError(409, 'Customer already has an appointment for this slot');
      }

      const staffId = await resolveBookingStaffId(tx, slot, data.staffId);

      const createdAppointment = await tx.appointment.create({
        data: {
          branchId: slot.branchId,
          customerId,
          slotId: slot.id,
          staffId,
          serviceTypeId: slot.serviceTypeId,
          notes: data.notes,
          attachmentUrl,
          status: 'SCHEDULED',
        },
        select: APPOINTMENT_SELECT,
      });

      await syncSlotBookedCount(tx, slot.id);

      return createdAppointment;
    });
    shouldRemoveUploadedFile = false;

    await logAuditFromRequest(
      req,
      'APPOINTMENT_CREATED',
      'Appointment',
      appointment.id,
      {
        branchId: appointment.branchId,
        customerId: appointment.customerId,
        slotId: appointment.slotId,
        staffId: appointment.staffId,
        serviceTypeId: appointment.serviceTypeId,
        status: publicStatus(appointment.status),
        attachmentUrl: appointment.attachmentUrl,
      }
    );

    res.status(201).json({
      success: true,
      data: serializeAppointment(appointment),
      message: 'Appointment booked successfully',
    });
  } catch (error) {
    if (shouldRemoveUploadedFile) {
      removeUploadedFile(req.file?.path);
    }

    if (handleAppointmentUploadError(error, res)) {
      return;
    }

    if (error instanceof ApiError) {
      sendError(res, error.statusCode, error.message);
      return;
    }

    console.error('Error creating appointment:', error);
    sendError(res, 500, 'Internal server error');
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const appointment = await getAppointmentOrThrow(String(req.params.id));
    assertAppointmentReadAccess(req, appointment);

    res.json({
      success: true,
      data: serializeAppointment(appointment),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(res, error.statusCode, error.message);
      return;
    }

    console.error('Error getting appointment:', error);
    sendError(res, 500, 'Internal server error');
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const validation = updateAppointmentSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, 400, 'Validation failed', validation.error.errors);
      return;
    }

    const appointment = await getAppointmentOrThrow(id);
    const updateData = validation.data;
    const requestedStatus = normalizeStatusInput(updateData.status);

    if (updateData.status && !requestedStatus) {
      throw new ApiError(400, 'Invalid appointment status');
    }

    const isReschedule = typeof updateData.slotId === 'string' && updateData.slotId.length > 0;
    const isStatusChange = !!requestedStatus && requestedStatus !== appointment.status;

    if (isReschedule && isStatusChange) {
      throw new ApiError(400, 'Cannot reschedule and update status in the same request');
    }

    if (isReschedule) {
      if (req.user?.role === 'STAFF') {
        throw new ApiError(403, 'Staff cannot reschedule appointments');
      }

      assertAppointmentReadAccess(req, appointment);

      if (
        appointment.status === 'IN_PROGRESS' ||
        appointment.status === 'COMPLETED' ||
        appointment.status === 'CANCELLED' ||
        appointment.status === 'NO_SHOW'
      ) {
        throw new ApiError(400, 'Only waiting appointments can be rescheduled');
      }

      const rescheduledAppointment = await prisma.$transaction(async (tx) => {
        const newSlot = await tx.slot.findUnique({
          where: { id: updateData.slotId! },
          select: {
            id: true,
            branchId: true,
            serviceTypeId: true,
            capacity: true,
            isActive: true,
            deletedAt: true,
            assignments: {
              select: {
                staffId: true,
              },
            },
          },
        });

        if (!newSlot) {
          throw new ApiError(404, 'New time slot not found');
        }

        if (!newSlot.isActive || newSlot.deletedAt) {
          throw new ApiError(400, 'New time slot is no longer available');
        }

        if (newSlot.id === appointment.slotId) {
          throw new ApiError(400, 'Appointment is already booked for this slot');
        }

        if (
          (req.user?.role === 'BRANCH_MANAGER' || req.user?.role === 'STAFF') &&
          req.user.branchId !== newSlot.branchId
        ) {
          throw new ApiError(403, 'Cannot reschedule outside your assigned branch');
        }

        const [activeCount, duplicate] = await Promise.all([
          tx.appointment.count({
            where: {
              slotId: newSlot.id,
              status: { in: ACTIVE_SLOT_STATUSES },
            },
          }),
          tx.appointment.findFirst({
            where: {
              id: { not: appointment.id },
              slotId: newSlot.id,
              customerId: appointment.customerId,
              status: { in: NON_CANCELLED_STATUSES },
            },
            select: { id: true },
          }),
        ]);

        if (activeCount >= SLOT_BOOKING_LIMIT) {
          throw new ApiError(409, 'New time slot already has a booking');
        }

        if (duplicate) {
          throw new ApiError(409, 'Customer already has an appointment for the selected new slot');
        }

        const nextStaffId = await resolveBookingStaffId(tx, newSlot, updateData.staffId ?? appointment.staffId ?? undefined);
        const updatedAppointment = await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            slotId: newSlot.id,
            branchId: newSlot.branchId,
            serviceTypeId: newSlot.serviceTypeId,
            staffId: nextStaffId,
            status: 'SCHEDULED',
            checkedInAt: null,
            startedAt: null,
            completedAt: null,
            cancelledAt: null,
            cancelReason: null,
            ...(updateData.notes !== undefined ? { notes: updateData.notes } : {}),
          },
          select: APPOINTMENT_SELECT,
        });

        await syncSlotBookedCount(tx, appointment.slotId);
        await syncSlotBookedCount(tx, newSlot.id);

        return updatedAppointment;
      });

      await logAuditFromRequest(
        req,
        'APPOINTMENT_RESCHEDULED',
        'Appointment',
        appointment.id,
        {
          branchId: rescheduledAppointment.branchId,
          previousBranchId: appointment.branchId,
          previousSlotId: appointment.slotId,
          newSlotId: rescheduledAppointment.slotId,
          previousStaffId: appointment.staffId,
          newStaffId: rescheduledAppointment.staffId,
        }
      );

      res.json({
        success: true,
        data: serializeAppointment(rescheduledAppointment),
        message: 'Appointment rescheduled successfully',
      });
      return;
    }

    if (isStatusChange) {
      assertAppointmentStatusAccess(req, appointment);
      assertValidStatusTransition(appointment.status, requestedStatus!);

      if (req.user?.role === 'STAFF' && requestedStatus === 'CANCELLED') {
        throw new ApiError(403, 'Staff cannot cancel appointments');
      }
    } else {
      assertAppointmentReadAccess(req, appointment);
    }

    if (req.user?.role === 'CUSTOMER' && (updateData.staffId || requestedStatus)) {
      throw new ApiError(403, 'Customers can only update their own notes or reschedule/cancel');
    }

    const updatedAppointment = await prisma.$transaction(async (tx) => {
      const nextData: Record<string, unknown> = {};

      if (updateData.notes !== undefined) {
        nextData.notes = updateData.notes;
      }

      if (requestedStatus) {
        nextData.status = requestedStatus;
      }

      if (updateData.cancelReason !== undefined) {
        nextData.cancelReason = updateData.cancelReason;
      }

      if (requestedStatus === 'IN_PROGRESS') {
        nextData.startedAt = new Date();
      }

      if (requestedStatus === 'CHECKED_IN') {
        nextData.checkedInAt = new Date();
      }

      if (requestedStatus === 'COMPLETED') {
        nextData.completedAt = new Date();
      }

      if (requestedStatus === 'CANCELLED') {
        nextData.cancelledAt = new Date();
      }

      if (updateData.staffId !== undefined) {
        if (req.user?.role === 'CUSTOMER') {
          throw new ApiError(403, 'Customers cannot reassign staff');
        }

        if (!appointment.slotId) {
          throw new ApiError(400, 'Cannot reassign staff for an appointment whose slot has been cleaned up');
        }

        const slot = await tx.slot.findUnique({
          where: { id: appointment.slotId },
          select: {
            branchId: true,
            assignments: {
              select: {
                staffId: true,
              },
            },
          },
        });

        if (!slot) {
          throw new ApiError(400, 'Cannot reassign staff for an appointment whose slot is no longer available');
        }

        nextData.staffId = await resolveBookingStaffId(tx, slot, updateData.staffId);
      }

      const savedAppointment = await tx.appointment.update({
        where: { id: appointment.id },
        data: nextData,
        select: APPOINTMENT_SELECT,
      });

      if (requestedStatus === 'CANCELLED' && appointment.status !== 'CANCELLED') {
        await syncSlotBookedCount(tx, appointment.slotId);
      }

      return savedAppointment;
    });

    if (requestedStatus && requestedStatus !== appointment.status) {
      await logAuditFromRequest(
        req,
        requestedStatus === 'CANCELLED' ? 'APPOINTMENT_CANCELLED' : 'APPOINTMENT_STATUS_CHANGED',
        'Appointment',
        appointment.id,
        {
          branchId: updatedAppointment.branchId,
          previousStatus: publicStatus(appointment.status),
          newStatus: publicStatus(updatedAppointment.status),
          staffId: updatedAppointment.staffId,
          cancelReason: updatedAppointment.cancelReason,
        }
      );
    }

    res.json({
      success: true,
      data: serializeAppointment(updatedAppointment),
      message: 'Appointment updated successfully',
    });
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(res, error.statusCode, error.message);
      return;
    }

    console.error('Error updating appointment:', error);
    sendError(res, 500, 'Internal server error');
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (req.user?.role === 'STAFF') {
      sendError(res, 403, 'Staff cannot cancel appointments');
      return;
    }

    const appointment = await getAppointmentOrThrow(String(req.params.id));
    assertAppointmentCancellationAccess(req, appointment);

    if (appointment.status === 'COMPLETED') {
      throw new ApiError(400, 'Cannot cancel completed appointments');
    }

    const cancelledAppointment = await prisma.$transaction(async (tx) => {
      if (appointment.status === 'CANCELLED') {
        return tx.appointment.findUniqueOrThrow({
          where: { id: appointment.id },
          select: APPOINTMENT_SELECT,
        });
      }

      const updatedAppointment = await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: appointment.cancelReason ?? 'Cancelled by user request',
        },
        select: APPOINTMENT_SELECT,
      });

      await syncSlotBookedCount(tx, appointment.slotId);

      return updatedAppointment;
    });

    if (appointment.status !== 'CANCELLED') {
      await logAuditFromRequest(
        req,
        'APPOINTMENT_CANCELLED',
        'Appointment',
        appointment.id,
        {
          branchId: cancelledAppointment.branchId,
          previousStatus: publicStatus(appointment.status),
          newStatus: publicStatus(cancelledAppointment.status),
          slotId: cancelledAppointment.slotId,
        }
      );
    }

    res.json({
      success: true,
      data: serializeAppointment(cancelledAppointment),
      message: 'Appointment cancelled successfully',
    });
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(res, error.statusCode, error.message);
      return;
    }

    console.error('Error cancelling appointment:', error);
    sendError(res, 500, 'Internal server error');
  }
});

export default router;
