import { z } from 'zod';

const optionalTrimmedString = () =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    },
    z.string().min(1).optional()
  );

// ============================================
// User & Auth schemas
// ============================================

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  idNumber: z.string().min(1),
  dateOfBirth: z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid dateOfBirth',
  }),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ============================================
// Branch schemas
// ============================================

export const createBranchSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).max(10),
  address: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  timezone: z.string().default('Asia/Muscat'),
});

export const updateBranchSchema = createBranchSchema.partial();

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

// ============================================
// Service Type schemas
// ============================================

export const createServiceTypeSchema = z.object({
  branchId: z.string(),
  name: z.string().min(1),
  code: z.string().min(1).max(10),
  description: z.string().optional(),
  duration: z.number().int().positive(),
});

export const updateServiceTypeSchema = createServiceTypeSchema.partial();

export type CreateServiceTypeInput = z.infer<typeof createServiceTypeSchema>;
export type UpdateServiceTypeInput = z.infer<typeof updateServiceTypeSchema>;

// ============================================
// Staff schemas
// ============================================

export const createStaffSchema = z.object({
  userId: z.string(),
  branchId: z.string(),
  position: z.string().optional(),
  employeeId: z.string().optional(),
  isManager: z.boolean().default(false),
});

export const updateStaffSchema = createStaffSchema.partial();

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

// ============================================
// Customer schemas
// ============================================

export const createCustomerSchema = z.object({
  userId: z.string(),
  idNumber: z.string().min(1),
  dateOfBirth: z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid dateOfBirth',
  }),
  idImageUrl: z.string().min(1),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

// ============================================
// Slot schemas
// ============================================

export const createSlotSchema = z.object({
  branchId: z.string(),
  serviceTypeId: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  capacity: z.number().int().positive().default(1),
});

export const updateSlotSchema = createSlotSchema.partial();

export type CreateSlotInput = z.infer<typeof createSlotSchema>;
export type UpdateSlotInput = z.infer<typeof updateSlotSchema>;

// ============================================
// Slot Assignment schemas
// ============================================

export const assignStaffToSlotSchema = z.object({
  staffId: z.string(),
});

export type AssignStaffToSlotInput = z.infer<typeof assignStaffToSlotSchema>;

// ============================================
// Appointment schemas
// ============================================

export const createAppointmentSchema = z.object({
  branchId: optionalTrimmedString(),
  customerId: optionalTrimmedString(),
  slotId: z.string(),
  staffId: optionalTrimmedString(),
  serviceTypeId: optionalTrimmedString(),
  notes: optionalTrimmedString(),
  attachmentUrl: optionalTrimmedString(),
});

export const updateAppointmentSchema = z.object({
  status: z.enum([
    'WAITING',
    'SERVING',
    'DONE',
    'CANCELLED',
    'SCHEDULED',
    'CHECKED_IN',
    'IN_PROGRESS',
    'COMPLETED',
    'NO_SHOW',
  ]).optional(),
  slotId: optionalTrimmedString(),
  staffId: optionalTrimmedString(),
  notes: optionalTrimmedString(),
  cancelReason: optionalTrimmedString(),
  checkedInAt: z.string().datetime().optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  cancelledAt: z.string().datetime().optional(),
});

export const checkInAppointmentSchema = z.object({
  appointmentId: z.string(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type CheckInAppointmentInput = z.infer<typeof checkInAppointmentSchema>;

export const updateRetentionConfigSchema = z.object({
  branchId: z.string(),
  retentionDays: z.number().int().positive(),
});

export type UpdateRetentionConfigInput = z.infer<typeof updateRetentionConfigSchema>;

// ============================================
// Query parameter schemas
// ============================================

export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().default(10),
});

export const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
export type DateRangeInput = z.infer<typeof dateRangeSchema>;

// ============================================
// Response types
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface AuthenticatedUser {
  customerId?: string;
  branchId?: string;
  staffId?: string;
  userId: string;
  email: string;
  role: 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF' | 'CUSTOMER';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
