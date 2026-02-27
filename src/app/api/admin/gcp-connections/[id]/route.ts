/**
 * /api/admin/gcp-connections/:id
 *
 * GET    - Get connection (credentials masked)
 * PUT    - Update connection
 * DELETE - Delete connection
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuthParams } from '@/lib/middleware';
import { logUpdate, logDelete } from '@/lib/audit';
import { success, notFound, serverError, badRequest } from '@/lib/utils';
import { z } from 'zod';

function forbidden() {
  return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
}

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  group: z.string().min(1).max(100).optional(),
  authType: z.enum(['SERVICE_ACCOUNT', 'API_KEY']).optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

function maskCredentials(authType: string, creds: unknown): unknown {
  if (authType === 'SERVICE_ACCOUNT') {
    const c = creds as Record<string, string>;
    return { client_email: c.client_email, private_key: '••••••••' };
  }
  if (authType === 'API_KEY') {
    const c = creds as Record<string, string>;
    const key = c.key ?? '';
    return { key: key.slice(0, 6) + '••••••••' };
  }
  return creds;
}

export const GET = withAuthParams(async (_request: NextRequest, context): Promise<NextResponse> => {
  if (!context.auth.isSuperAdmin) return forbidden();
  const { id } = context.params;

  try {
    const conn = await prisma.gcpConnection.findUnique({ where: { id } });
    if (!conn) return notFound('GCP connection not found');

    return success({
      id: conn.id,
      name: conn.name,
      description: conn.description,
      group: conn.group,
      authType: conn.authType,
      credentials: maskCredentials(conn.authType, conn.credentials),
      isDefault: conn.isDefault,
      isActive: conn.isActive,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    });
  } catch (err) {
    console.error('Failed to get GCP connection:', err);
    return serverError('Failed to retrieve GCP connection');
  }
});

export const PUT = withAuthParams(async (request: NextRequest, context): Promise<NextResponse> => {
  if (!context.auth.isSuperAdmin) return forbidden();
  const { id } = context.params;

  try {
    const existing = await prisma.gcpConnection.findUnique({ where: { id } });
    if (!existing) return notFound('GCP connection not found');

    const body = await request.json();
    const validation = updateSchema.safeParse(body);
    if (!validation.success) {
      return badRequest('Invalid request body', { errors: validation.error.flatten() });
    }

    const data = validation.data;
    const updateGroup = data.group ?? existing.group;

    // If setting as default, clear others in the same group
    if (data.isDefault === true) {
      await prisma.gcpConnection.updateMany({
        where: { group: updateGroup, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.gcpConnection.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.group !== undefined && { group: data.group }),
        ...(data.authType !== undefined && { authType: data.authType }),
        ...(data.credentials !== undefined && { credentials: data.credentials as object }),
        ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    await logUpdate(
      context,
      'gcp_connections',
      id,
      { name: existing.name, group: existing.group, authType: existing.authType },
      { name: updated.name, group: updated.group, authType: updated.authType }
    );

    return success({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      group: updated.group,
      authType: updated.authType,
      credentials: maskCredentials(updated.authType, updated.credentials),
      isDefault: updated.isDefault,
      isActive: updated.isActive,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    console.error('Failed to update GCP connection:', err);
    return serverError('Failed to update GCP connection');
  }
});

export const DELETE = withAuthParams(async (_request: NextRequest, context): Promise<NextResponse> => {
  if (!context.auth.isSuperAdmin) return forbidden();
  const { id } = context.params;

  try {
    const existing = await prisma.gcpConnection.findUnique({ where: { id } });
    if (!existing) return notFound('GCP connection not found');

    await prisma.gcpConnection.delete({ where: { id } });

    await logDelete(context, 'gcp_connections', id, {
      name: existing.name,
      group: existing.group,
    });

    return success({ deleted: true });
  } catch (err) {
    console.error('Failed to delete GCP connection:', err);
    return serverError('Failed to delete GCP connection');
  }
});
