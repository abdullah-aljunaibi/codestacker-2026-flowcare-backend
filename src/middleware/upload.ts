import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs';

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = 'uploads/';
    
    // Determine upload path based on file type
    if (file.fieldname === 'idImage' || file.fieldname === 'customerIdImage') {
      uploadPath = 'uploads/customer-ids/';
    } else if (file.fieldname === 'appointmentAttachment') {
      uploadPath = 'uploads/appointment-attachments/';
    }
    
    // Ensure directory exists
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with original extension
    const uniqueName = randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueName}${ext}`);
  },
});

// File filter for validation
const fileFilter = (req: any, file: any, cb: any) => {
  const imageMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const documentMimeTypes = [...imageMimeTypes, 'application/pdf'];
  const documentExtensions = [...imageExtensions, '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  const isIdImageField = file.fieldname === 'idImage' || file.fieldname === 'customerIdImage';
  const allowedMimeTypes = isIdImageField ? imageMimeTypes : documentMimeTypes;
  const allowedExtensions = isIdImageField ? imageExtensions : documentExtensions;

  if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. ID images must be JPEG, PNG, GIF, or WebP. Appointment attachments may also be PDF.'), false);
  }
};

// Configure multer upload
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Error handling middleware for multer
export const handleMulterError = (err: any, req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum file size is 5MB.',
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
  }
  
  if (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
  
  next();
};

export default upload;
