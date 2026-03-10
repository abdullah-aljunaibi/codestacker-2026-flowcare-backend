import bcrypt from 'bcrypt';
import { PrismaClient, Role } from '@prisma/client';
import { readFile } from 'fs/promises';

type BootstrapLogger = Pick<Console, 'log' | 'error'>;

type SeedData = {
  defaultAdmin: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  };
  branches: Array<{
    code: string;
    name: string;
    address?: string;
    city?: string;
    phone?: string;
    email?: string;
    timezone?: string;
    isActive?: boolean;
  }>;
  serviceTypes: Array<{
    branchCode: string;
    code: string;
    name: string;
    description?: string;
    duration: number;
    isActive?: boolean;
  }>;
  staff: Array<{
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    role: Role;
    branchCode: string;
    position?: string;
    employeeId?: string;
    isManager?: boolean;
  }>;
  slots: Array<{
    branchCode: string;
    serviceTypeCode: string;
    dayOffset: number;
    startTime: string;
    endTime: string;
    capacity?: number;
    assignedStaffEmails?: string[];
  }>;
};

type BootstrapOptions = {
  prisma?: PrismaClient;
  logger?: BootstrapLogger;
  createAdminIfMissingOnly?: boolean;
};

export type BootstrapResult = {
  adminAction: 'created' | 'updated' | 'skipped';
  branchesUpserted: number;
  serviceTypesUpserted: number;
  staffUpserted: number;
  slotsUpserted: number;
  slotAssignmentsUpserted: number;
};

const seedDataUrl = new URL('../../prisma/seed-data.json', import.meta.url);

async function loadSeedData(): Promise<SeedData> {
  const contents = await readFile(seedDataUrl, 'utf8');
  return JSON.parse(contents) as SeedData;
}

function buildRelativeDate(dayOffset: number, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date();
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + dayOffset);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export async function bootstrapDatabase(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const prisma = options.prisma ?? new PrismaClient();
  const logger = options.logger ?? console;
  const seedData = await loadSeedData();
  let ownsPrisma = false;

  if (!options.prisma) {
    ownsPrisma = true;
  }

  try {
    logger.log('[bootstrap] loading seed data from prisma/seed-data.json');

    const adminCount = await prisma.user.count({
      where: { role: Role.ADMIN },
    });

    let adminAction: BootstrapResult['adminAction'] = 'skipped';

    if (!options.createAdminIfMissingOnly || adminCount === 0) {
      const hashedPassword = await bcrypt.hash(seedData.defaultAdmin.password, 10);

      await prisma.user.upsert({
        where: { email: seedData.defaultAdmin.email },
        update: adminCount === 0 ? {
          password: hashedPassword,
          firstName: seedData.defaultAdmin.firstName,
          lastName: seedData.defaultAdmin.lastName,
          phone: seedData.defaultAdmin.phone,
          role: Role.ADMIN,
        } : {},
        create: {
          email: seedData.defaultAdmin.email,
          password: hashedPassword,
          firstName: seedData.defaultAdmin.firstName,
          lastName: seedData.defaultAdmin.lastName,
          phone: seedData.defaultAdmin.phone,
          role: Role.ADMIN,
        },
      });

      adminAction = adminCount === 0 ? 'created' : 'updated';
      logger.log(`[bootstrap] admin ${adminAction}: ${seedData.defaultAdmin.email}`);
    } else {
      logger.log('[bootstrap] admin bootstrap skipped because at least one admin already exists');
    }

    const branchIds = new Map<string, string>();
    for (const branch of seedData.branches) {
      const record = await prisma.branch.upsert({
        where: { code: branch.code },
        update: {
          name: branch.name,
          address: branch.address,
          city: branch.city,
          phone: branch.phone,
          email: branch.email,
          timezone: branch.timezone ?? 'Asia/Muscat',
          isActive: branch.isActive ?? true,
        },
        create: {
          code: branch.code,
          name: branch.name,
          address: branch.address,
          city: branch.city,
          phone: branch.phone,
          email: branch.email,
          timezone: branch.timezone ?? 'Asia/Muscat',
          isActive: branch.isActive ?? true,
        },
      });
      branchIds.set(branch.code, record.id);
      logger.log(`[bootstrap] branch upserted: ${branch.code}`);
    }

    const serviceTypeIds = new Map<string, string>();
    for (const serviceType of seedData.serviceTypes) {
      const branchId = branchIds.get(serviceType.branchCode);
      if (!branchId) {
        throw new Error(`Unknown branch code in serviceTypes: ${serviceType.branchCode}`);
      }

      const record = await prisma.serviceType.upsert({
        where: {
          branchId_code: {
            branchId,
            code: serviceType.code,
          },
        },
        update: {
          name: serviceType.name,
          description: serviceType.description,
          duration: serviceType.duration,
          isActive: serviceType.isActive ?? true,
        },
        create: {
          branchId,
          code: serviceType.code,
          name: serviceType.name,
          description: serviceType.description,
          duration: serviceType.duration,
          isActive: serviceType.isActive ?? true,
        },
      });
      serviceTypeIds.set(`${serviceType.branchCode}:${serviceType.code}`, record.id);
      logger.log(`[bootstrap] service type upserted: ${serviceType.branchCode}/${serviceType.code}`);
    }

    const staffIds = new Map<string, string>();
    for (const member of seedData.staff) {
      const branchId = branchIds.get(member.branchCode);
      if (!branchId) {
        throw new Error(`Unknown branch code in staff: ${member.branchCode}`);
      }

      const hashedPassword = await bcrypt.hash(member.password, 10);
      const user = await prisma.user.upsert({
        where: { email: member.email },
        update: {
          password: hashedPassword,
          firstName: member.firstName,
          lastName: member.lastName,
          phone: member.phone,
          role: member.role,
        },
        create: {
          email: member.email,
          password: hashedPassword,
          firstName: member.firstName,
          lastName: member.lastName,
          phone: member.phone,
          role: member.role,
        },
      });

      const staff = await prisma.staff.upsert({
        where: { userId: user.id },
        update: {
          branchId,
          position: member.position,
          employeeId: member.employeeId,
          isManager: member.isManager ?? member.role === Role.BRANCH_MANAGER,
        },
        create: {
          userId: user.id,
          branchId,
          position: member.position,
          employeeId: member.employeeId,
          isManager: member.isManager ?? member.role === Role.BRANCH_MANAGER,
        },
      });

      staffIds.set(member.email, staff.id);
      logger.log(`[bootstrap] staff upserted: ${member.email}`);
    }

    let slotAssignmentsUpserted = 0;
    for (const slotSeed of seedData.slots) {
      const branchId = branchIds.get(slotSeed.branchCode);
      const serviceTypeId = serviceTypeIds.get(`${slotSeed.branchCode}:${slotSeed.serviceTypeCode}`);

      if (!branchId) {
        throw new Error(`Unknown branch code in slots: ${slotSeed.branchCode}`);
      }

      if (!serviceTypeId) {
        throw new Error(`Unknown service type in slots: ${slotSeed.branchCode}/${slotSeed.serviceTypeCode}`);
      }

      const startTime = buildRelativeDate(slotSeed.dayOffset, slotSeed.startTime);
      const endTime = buildRelativeDate(slotSeed.dayOffset, slotSeed.endTime);

      const existingSlot = await prisma.slot.findFirst({
        where: {
          branchId,
          serviceTypeId,
          startTime,
          endTime,
        },
      });

      const slot = existingSlot
        ? await prisma.slot.update({
            where: { id: existingSlot.id },
            data: {
              capacity: slotSeed.capacity ?? 1,
              isActive: true,
            },
          })
        : await prisma.slot.create({
            data: {
              branchId,
              serviceTypeId,
              startTime,
              endTime,
              capacity: slotSeed.capacity ?? 1,
              bookedCount: 0,
              isActive: true,
            },
          });

      logger.log(`[bootstrap] slot upserted: ${slotSeed.branchCode}/${slotSeed.serviceTypeCode} ${slotSeed.dayOffset} ${slotSeed.startTime}`);

      for (const staffEmail of slotSeed.assignedStaffEmails ?? []) {
        const staffId = staffIds.get(staffEmail);
        if (!staffId) {
          throw new Error(`Unknown staff email in slots: ${staffEmail}`);
        }

        await prisma.slotAssignment.upsert({
          where: {
            slotId_staffId: {
              slotId: slot.id,
              staffId,
            },
          },
          update: {},
          create: {
            slotId: slot.id,
            staffId,
          },
        });
        slotAssignmentsUpserted += 1;
      }
    }

    return {
      adminAction,
      branchesUpserted: seedData.branches.length,
      serviceTypesUpserted: seedData.serviceTypes.length,
      staffUpserted: seedData.staff.length,
      slotsUpserted: seedData.slots.length,
      slotAssignmentsUpserted,
    };
  } finally {
    if (ownsPrisma) {
      await prisma.$disconnect();
    }
  }
}
