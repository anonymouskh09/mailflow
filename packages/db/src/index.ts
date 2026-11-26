import { PrismaClient, Prisma } from '@prisma/client';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __mfPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__mfPrisma ?? new PrismaClient({ log: ['warn', 'error'] });
globalForPrisma.__mfPrisma = prisma;

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
