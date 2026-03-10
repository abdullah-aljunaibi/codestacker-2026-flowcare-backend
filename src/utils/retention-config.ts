import { Prisma, PrismaClient } from '@prisma/client';

export const DEFAULT_RETENTION_DAYS = 30;

type RetentionClient = PrismaClient | Prisma.TransactionClient;

export async function getEffectiveRetentionConfigs(prisma: RetentionClient) {
  const [branches, configs] = await Promise.all([
    prisma.branch.findMany({
      select: {
        id: true,
        name: true,
        code: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.retentionConfig.findMany({
      select: {
        branchId: true,
        retentionDays: true,
        updatedAt: true,
        updatedBy: true,
      },
    }),
  ]);

  const configMap = new Map(configs.map((config) => [config.branchId, config]));

  return branches.map((branch) => {
    const config = configMap.get(branch.id);

    return {
      branchId: branch.id,
      branchName: branch.name,
      branchCode: branch.code,
      retentionDays: config?.retentionDays ?? DEFAULT_RETENTION_DAYS,
      updatedAt: config?.updatedAt ?? null,
      updatedBy: config?.updatedBy ?? null,
      configured: !!config,
    };
  });
}

export async function getBranchRetentionDays(prisma: RetentionClient, branchId: string) {
  const config = await prisma.retentionConfig.findUnique({
    where: { branchId },
    select: { retentionDays: true },
  });

  return config?.retentionDays ?? DEFAULT_RETENTION_DAYS;
}
