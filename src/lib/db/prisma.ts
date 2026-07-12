/**
 * Prisma Client Singleton for PostgreSQL
 *
 * This module provides a single instance of PrismaClient configured with
 * the PostgreSQL driver adapter.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL!;
const defaultPoolMax = process.env.VERCEL === '1' ? 1 : 5;
const poolMax = Number(process.env.DATABASE_POOL_MAX || defaultPoolMax);
const connectionTimeoutMillis = Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS || 30_000);
const idleTimeoutMillis = Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 60_000);
const PRISMA_RETRY_ATTEMPTS = Number(process.env.DATABASE_QUERY_RETRY_ATTEMPTS || 4);
const PRISMA_RETRY_DELAY_MS = Number(process.env.DATABASE_QUERY_RETRY_DELAY_MS || 250);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPool: Pool | undefined;
};

function getErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function getErrorMessages(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) return [];
  seen.add(error);

  const messages = [error instanceof Error ? error.message : String(error)];
  if (typeof error === 'object' && 'cause' in error) {
    messages.push(...getErrorMessages((error as { cause?: unknown }).cause, seen));
  }
  return messages;
}

export function isTransientPrismaError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'P1001', 'P1017', 'P2037'].includes(code)) {
    return true;
  }

  const message = getErrorMessages(error).join('\n');
  return [
    'Client network socket disconnected before secure TLS connection was established',
    'Connection terminated due to connection timeout',
    'Connection terminated unexpectedly',
    'Client has encountered a connection error and is not queryable',
    'terminating connection due to administrator command',
  ].some((snippet) => message.includes(snippet));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTransientPrismaRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= PRISMA_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt < PRISMA_RETRY_ATTEMPTS && isTransientPrismaError(error)) {
        await wait(PRISMA_RETRY_DELAY_MS * attempt);
        continue;
      }
      throw error;
    }
  }

  return operation();
}

function createPrismaClient(): PrismaClient {
  const pool = globalForPrisma.prismaPool ?? new Pool({
    connectionString,
    max: poolMax,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });

  globalForPrisma.prismaPool = pool;

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn'] : ['warn'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;

export default prisma;
