/**
 * /api/admin/gcp-connections
 *
 * GCP Connection management — super admin only.
 *
 * GET  - List all connections (grouped by group field)
 * POST - Create a new connection
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import {
  success,
  created,
  serverError,
  badRequest,
} from '@/lib/utils';
import { z } from 'zod';

function forbidden() {
  return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
}

const serviceAccountCredsSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

const apiKeyCredsSchema = z.object({
  key: z.string().min(1),
});

const createConnectionSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  group: z.string().min(1).max(100).default('default'),
  authType: z.enum(['SERVICE_ACCOUNT', 'API_KEY']),
  credentials: z.record(z.string(), z.unknown()),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

/**
 * GET /api/admin/gcp-connections
 * Returns connections grouped by their `group` field.
 */
export const GET = withAuth(async (_request: NextRequest, context): Promise<NextResponse> => {
  if (!context.auth.isSuperAdmin) return forbidden();

  try {
    const connections = await prisma.gcpConnection.findMany({
      orderBy: [{ group: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        group: true,
        authType: true,
        isDefault: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { firstName: true, lastName: true, email: true } },
        // Never expose credentials in list
      },
    });

    // Group by group field
    const grouped: Record<string, typeof connections> = {};
    for (const c of connections) {
      if (!grouped[c.group]) grouped[c.group] = [];
      grouped[c.group].push(c);
    }

    return success({ data: connections, grouped });
  } catch (err) {
    console.error('Failed to list GCP connections:', err);
    return serverError('Failed to retrieve GCP connections');
  }
});

/**
 * POST /api/admin/gcp-connections
 */
export const POST = withAuth(async (request: NextRequest, context): Promise<NextResponse> => {
  if (!context.auth.isSuperAdmin) return forbidden();

  try {
    const body = await request.json();
    const validation = createConnectionSchema.safeParse(body);
    if (!validation.success) {
      return badRequest('Invalid request body', { errors: validation.error.flatten() });
    }

    const data = validation.data;

    // Validate credentials shape
    if (data.authType === 'SERVICE_ACCOUNT') {
      const credCheck = serviceAccountCredsSchema.safeParse(data.credentials);
      if (!credCheck.success) {
        return badRequest('SERVICE_ACCOUNT credentials must include client_email and private_key');
      }
    }
    if (data.authType === 'API_KEY') {
      const credCheck = apiKeyCredsSchema.safeParse(data.credentials);
      if (!credCheck.success) {
        return badRequest('API_KEY credentials must include key');
      }
    }

    // If setting as default, clear existing defaults in same group
    if (data.isDefault) {
      await prisma.gcpConnection.updateMany({
        where: { group: data.group, isDefault: true },
        data: { isDefault: false },
      });
    }

    const connection = await prisma.gcpConnection.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        group: data.group,
        authType: data.authType,
        credentials: data.credentials as object,
        isDefault: data.isDefault,
        isActive: data.isActive,
        createdById: context.auth.userId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        group: true,
        authType: true,
        isDefault: true,
        isActive: true,
        createdAt: true,
      },
    });

    await logCreate(context, 'gcp_connections', connection.id, {
      name: connection.name,
      group: connection.group,
      authType: connection.authType,
    });

    return created({ connection });
  } catch (err) {
    console.error('Failed to create GCP connection:', err);
    return serverError('Failed to create GCP connection');
  }
});
