import { PrismaClient } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';

const prisma = new PrismaClient();

export type AuditAction =
  | 'APPOINTMENT_CREATED'
  | 'APPOINTMENT_RESCHEDULED'
  | 'APPOINTMENT_CANCELLED'
  | 'APPOINTMENT_STATUS_CHANGED'
  | 'AUTH_LOGIN_SUCCEEDED'
  | 'AUTH_LOGIN_FAILED'
  | 'SLOT_CREATED'
  | 'SLOT_UPDATED'
  | 'SLOT_DELETED'
  | 'SLOT_SOFT_DELETED'
  | 'SLOT_RESTORED'
  | 'STAFF_ASSIGNED'
  | 'STAFF_UNASSIGNED'
  | 'STAFF_ASSIGNMENT_CHANGED'
  | 'USER_REGISTERED'
  | 'BRANCH_CREATED'
  | 'BRANCH_UPDATED'
  | 'BRANCH_DELETED'
  | 'SERVICE_TYPE_CREATED'
  | 'SERVICE_TYPE_UPDATED'
  | 'SERVICE_TYPE_DELETED'
  | 'CUSTOMER_ID_ACCESSED'
  | 'CUSTOMER_ID_UPLOADED'
  | 'APPOINTMENT_ATTACHMENT_ACCESSED'
  | 'APPOINTMENT_ATTACHMENT_UPLOADED'
  | 'DATA_CLEANUP'
  | 'RETENTION_CLEANUP'
  | 'RETENTION_CONFIG_VIEWED'
  | 'RETENTION_CONFIG_UPDATED';

export interface AuditMetadata {
  [key: string]: any;
}

/**
 * Log an audit entry
 */
export async function logAudit(
  userId: string | null | undefined,
  action: AuditAction,
  entity?: string,
  entityId?: string,
  metadata?: AuditMetadata,
  ipAddress?: string,
  branchId?: string | null
): Promise<void> {
  try {
    const derivedBranchId =
      branchId ??
      (typeof metadata?.branchId === 'string' && metadata.branchId.length > 0 ? metadata.branchId : null);

    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action,
        entity: entity || null,
        entityId: entityId || null,
        branchId: derivedBranchId,
        metadata: metadata || null,
        ipAddress: ipAddress || null,
      },
    });
  } catch (error) {
    // Don't fail the main operation if audit logging fails
    console.error('Audit logging failed:', error);
  }
}

/**
 * Extract user ID from request for audit logging
 */
export function getUserIdFromRequest(req: Request): string | undefined {
  return req.user?.userId;
}

/**
 * Extract IP address from request
 */
export function getIpAddressFromRequest(req: Request): string | undefined {
  return (
    req.headers['x-forwarded-for'] as string ||
    req.headers['x-real-ip'] as string ||
    req.ip ||
    undefined
  );
}

/**
 * Create audit logging middleware for specific actions
 */
export function createAuditLogger(
  action: AuditAction,
  entity: string,
  getIdFromRequest: (req: Request) => string | undefined = getUserIdFromRequest
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const originalJson = res.json.bind(res);
    
    res.json = (body: any) => {
      // Log after response is prepared
      const entityId = req.params.id || req.body?.id || body?.data?.id;
      const metadata: AuditMetadata = {
        method: req.method,
        path: req.path,
        requestBody: req.method !== 'GET' ? sanitizeRequestBody(req.body) : undefined,
        responseBody: sanitizeResponseBody(body),
      };
      
      logAudit(
        getIdFromRequest(req),
        action,
        entity,
        entityId,
        metadata,
        getIpAddressFromRequest(req)
      ).catch(console.error);
      
      return originalJson(body);
    };
    
    next();
  };
}

/**
 * Sanitize request body for audit log (remove sensitive data)
 */
function sanitizeRequestBody(body: any): any {
  if (!body) return undefined;
  
  const sanitized = { ...body };
  
  // Remove sensitive fields
  delete sanitized.password;
  delete sanitized.token;
  delete sanitized.accessToken;
  delete sanitized.refreshToken;
  
  return sanitized;
}

/**
 * Sanitize response body for audit log
 */
function sanitizeResponseBody(body: any): any {
  if (!body) return undefined;
  
  // For success responses, just note success
  if (body?.success !== undefined) {
    return { success: body.success };
  }
  
  return body;
}
