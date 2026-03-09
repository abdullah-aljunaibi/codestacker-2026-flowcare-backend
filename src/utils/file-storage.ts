import path from 'path';
import fs from 'fs';

/**
 * File storage utilities for FlowCare
 * Handles file path resolution, validation, and cleanup
 */

export interface UploadedFile {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  uploadedAt: Date;
}

/**
 * Get the base upload directory
 */
export const getUploadBasePath = (): string => {
  return path.join(process.cwd(), 'uploads');
};

/**
 * Get the path for customer ID uploads
 */
export const getCustomerIdUploadPath = (): string => {
  return path.join(getUploadBasePath(), 'customer-ids');
};

/**
 * Get the path for appointment attachment uploads
 */
export const getAppointmentAttachmentPath = (): string => {
  return path.join(getUploadBasePath(), 'appointment-attachments');
};

/**
 * Validate file extension
 */
export const isValidFileExtension = (filename: string): boolean => {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];
  const ext = path.extname(filename).toLowerCase();
  return allowedExtensions.includes(ext);
};

/**
 * Get file size in bytes
 */
export const getFileSize = (filePath: string): number => {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (error) {
    return 0;
  }
};

/**
 * Delete a file
 */
export const deleteFile = (filePath: string): boolean => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
};

/**
 * Get file metadata
 */
export const getFileMetadata = (filePath: string): UploadedFile | null => {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const stats = fs.statSync(filePath);
    const filename = path.basename(filePath);
    
    return {
      filename: filename,
      originalName: filename,
      mimeType: '',
      size: stats.size,
      path: filePath,
      uploadedAt: stats.birthtime,
    };
  } catch (error) {
    console.error('Error getting file metadata:', error);
    return null;
  }
};

/**
 * Ensure upload directories exist
 */
export const ensureUploadDirectories = (): void => {
  const paths = [
    getUploadBasePath(),
    getCustomerIdUploadPath(),
    getAppointmentAttachmentPath(),
  ];
  
  paths.forEach((dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`Created upload directory: ${dirPath}`);
    }
  });
};
