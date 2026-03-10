import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { logAudit, getIpAddressFromRequest } from '../utils/audit-logger.js';
import path from 'path';
import fs from 'fs';
import mime from 'mime-types';
import multer from 'multer';
import { randomUUID } from 'crypto';

const router = Router();
const prisma = new PrismaClient();
const PRIVATE_STORAGE_ROOT = path.join(process.cwd(), 'storage', 'private');
const PRIVATE_APPOINTMENT_ATTACHMENT_DIR = path.join(PRIVATE_STORAGE_ROOT, 'appointment-attachments');
const APPOINTMENT_ATTACHMENT_MAX_SIZE = 5 * 1024 * 1024;
const APPOINTMENT_ATTACHMENT_MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};
const appointmentAttachmentUpload = multer({
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

// All upload routes require authentication
router.use(authMiddleware);

function removeUploadedFile(filePath?: string) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  fs.unlinkSync(filePath);
}

function handleAttachmentUploadError(error: unknown, res: Response) {
  if (error instanceof multer.MulterError) {
    const multerError = error as multer.MulterError;

    if (multerError.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        success: false,
        error: `Attachment too large. Maximum file size is ${Math.floor(APPOINTMENT_ATTACHMENT_MAX_SIZE / (1024 * 1024))}MB.`,
      });
      return true;
    }

    res.status(400).json({
      success: false,
      error: `Upload error: ${multerError.message}`,
    });
    return true;
  }

  if (error instanceof Error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
    return true;
  }

  return false;
}

function storeAttachment(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    appointmentAttachmentUpload.single('appointmentAttachment')(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function isPathInsideRoot(rootPath: string, candidatePath: string) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function resolveStoredFilePath(fileReference: string): string | null {
  const normalizedReference = fileReference.replace(/\\/g, '/');

  if (normalizedReference.startsWith('/uploads/')) {
    const legacyRelativePath = normalizedReference.slice(1);
    const resolvedLegacyPath = path.resolve(process.cwd(), legacyRelativePath);
    const legacyRoot = path.resolve(process.cwd(), 'uploads');

    if (!isPathInsideRoot(legacyRoot, resolvedLegacyPath)) {
      return null;
    }

    return resolvedLegacyPath;
  }

  const relativeReference = normalizedReference.replace(/^\/+/, '');
  const resolvedPrivatePath = path.resolve(PRIVATE_STORAGE_ROOT, relativeReference);

  if (!isPathInsideRoot(PRIVATE_STORAGE_ROOT, resolvedPrivatePath)) {
    return null;
  }

  return resolvedPrivatePath;
}

/**
 * GET /api/files/customer-id/:customerId
 * Retrieve customer ID image
 * 
 * Access:
 * - ADMIN: can retrieve any customer ID image
 * - BRANCH_MANAGER/STAFF/CUSTOMER: NOT permitted
 */
router.get('/customer-id/:customerId',
  roleMiddleware(['ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const customerId = String(req.params.customerId);
      
      // Verify customer exists and has an ID image
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { idImageUrl: true, userId: true },
      });
      
      if (!customer) {
        res.status(404).json({
          success: false,
          error: 'Customer not found',
        });
        return;
      }
      
      if (!customer.idImageUrl) {
        res.status(404).json({
          success: false,
          error: 'Customer ID image not found',
        });
        return;
      }
      
      // Resolve file path
      const filePath = path.join(process.cwd(), customer.idImageUrl);
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.error('Customer ID file missing from disk:', filePath);
        res.status(404).json({
          success: false,
          error: 'File not found on server',
        });
        return;
      }
      
      // Determine content type
      const mimeType = mime.lookup(customer.idImageUrl) || 'application/octet-stream';
      
      // Audit log
      await logAudit(
        req.user?.userId,
        'CUSTOMER_ID_ACCESSED',
        'Customer',
        customerId,
        {
          fileUrl: customer.idImageUrl,
          action: 'download',
        },
        getIpAddressFromRequest(req)
      );
      
      // Send file with correct content type
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(customer.idImageUrl)}"`);
      res.sendFile(filePath);
    } catch (error) {
      console.error('Error retrieving customer ID:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

/**
 * GET /api/files/appointment/:appointmentId/attachment
 * Retrieve appointment attachment
 * 
 * Access:
 * - ADMIN: can retrieve any appointment attachment
 * - BRANCH_MANAGER/STAFF: can retrieve attachments for appointments at their branch
 * - CUSTOMER: can retrieve attachments for their own appointments only
 */
router.get('/appointment/:appointmentId/attachment',
  roleMiddleware(['ADMIN', 'BRANCH_MANAGER', 'STAFF', 'CUSTOMER']),
  async (req: Request, res: Response) => {
    try {
      const appointmentId = String(req.params.appointmentId);
      
      // Verify appointment exists and has an attachment
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          attachmentUrl: true,
          customerId: true,
          branchId: true,
          status: true,
        },
      });
      
      if (!appointment) {
        res.status(404).json({
          success: false,
          error: 'Appointment not found',
        });
        return;
      }
      
      if (!appointment.attachmentUrl) {
        res.status(404).json({
          success: false,
          error: 'Appointment attachment not found',
        });
        return;
      }
      
      // Check permission
      if (req.user?.role === 'CUSTOMER') {
        // CUSTOMER can only access their own appointment attachments
        if (!req.user?.customerId || appointment.customerId !== req.user.customerId) {
          res.status(403).json({
            success: false,
            error: 'Access denied: Can only access attachments for your own appointments',
          });
          return;
        }
      } else if (req.user?.role === 'STAFF' || req.user?.role === 'BRANCH_MANAGER') {
        // STAFF/BRANCH_MANAGER can only access attachments for appointments at their branch
        if (req.user?.branchId && appointment.branchId !== req.user.branchId) {
          res.status(403).json({
            success: false,
            error: 'Access denied: Can only access attachments for appointments at your branch',
          });
          return;
        }
      }
      // ADMIN can access any appointment attachment
      
      // Resolve file path
      const filePath = resolveStoredFilePath(appointment.attachmentUrl);

      if (!filePath) {
        res.status(400).json({
          success: false,
          error: 'Invalid attachment reference',
        });
        return;
      }
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        console.error('Appointment attachment file missing from disk:', filePath);
        res.status(404).json({
          success: false,
          error: 'File not found on server',
        });
        return;
      }
      
      // Determine content type
      const mimeType = mime.lookup(appointment.attachmentUrl) || 'application/octet-stream';
      
      // Audit log
      await logAudit(
        req.user?.userId,
        'APPOINTMENT_ATTACHMENT_ACCESSED',
        'Appointment',
        appointmentId,
        {
          branchId: appointment.branchId,
          fileUrl: appointment.attachmentUrl,
          action: 'download',
        },
        getIpAddressFromRequest(req),
        appointment.branchId
      );
      
      // Send file with correct content type
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(appointment.attachmentUrl)}"`);
      res.sendFile(filePath);
    } catch (error) {
      console.error('Error retrieving appointment attachment:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

/**
 * POST /api/uploads/appointment-attachment
 * Upload appointment attachment (optional document)
 * 
 * Access:
 * - CUSTOMER: can upload attachment for their own appointments
 * - ADMIN/BRANCH_MANAGER/STAFF: can upload for any appointment at their branch
 */
router.post('/appointment-attachment',
  roleMiddleware(['ADMIN', 'BRANCH_MANAGER', 'STAFF', 'CUSTOMER']),
  async (req: Request, res: Response) => {
    let shouldRemoveUploadedFile = false;

    try {
      await storeAttachment(req, res);
      shouldRemoveUploadedFile = Boolean(req.file?.path);

      if (!req.file) {
        res.status(400).json({
          success: false,
          error: 'No file uploaded',
        });
        return;
      }
      
      const { appointmentId } = req.body;
      
      if (!appointmentId) {
        removeUploadedFile(req.file.path);
        res.status(400).json({
          success: false,
          error: 'Appointment ID is required',
        });
        return;
      }
      
      // Verify appointment exists
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          id: true,
          customerId: true,
          branchId: true,
          status: true,
        },
      });
      
      if (!appointment) {
        res.status(404).json({
          success: false,
          error: 'Appointment not found',
        });
        return;
      }
      
      // Check permission
      if (req.user?.role === 'CUSTOMER') {
        // CUSTOMER can only upload for their own appointments
        if (!req.user?.customerId || appointment.customerId !== req.user.customerId) {
          removeUploadedFile(req.file.path);
          res.status(403).json({
            success: false,
            error: 'Access denied: Can only upload attachments for your own appointments',
          });
          return;
        }
      } else if (req.user?.role === 'STAFF' || req.user?.role === 'BRANCH_MANAGER') {
        // STAFF/BRANCH_MANAGER can only upload for appointments at their branch
        if (req.user?.branchId && appointment.branchId !== req.user.branchId) {
          removeUploadedFile(req.file.path);
          res.status(403).json({
            success: false,
            error: 'Access denied: Can only upload attachments for appointments at your branch',
          });
          return;
        }
      }
      // ADMIN can upload for any appointment
      
      const fileUrl = path.posix.join('appointment-attachments', req.file.filename);

      await prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: appointmentId },
          data: { attachmentUrl: fileUrl },
        });
      });
      shouldRemoveUploadedFile = false;
      
      // Audit log
      await logAudit(
        req.user?.userId,
        'APPOINTMENT_ATTACHMENT_UPLOADED',
        'Appointment',
        appointmentId,
        {
          branchId: appointment.branchId,
          fileUrl: fileUrl,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
        },
        getIpAddressFromRequest(req),
        appointment.branchId
      );
      
      res.json({
        success: true,
        data: {
          fileUrl: fileUrl,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
        },
        message: 'Appointment attachment uploaded successfully',
      });
    } catch (error) {
      if (shouldRemoveUploadedFile) {
        removeUploadedFile(req.file?.path);
      }

      if (handleAttachmentUploadError(error, res)) {
        return;
      }

      console.error('Error uploading appointment attachment:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  }
);

export default router;
