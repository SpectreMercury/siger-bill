/**
 * /api/roles
 *
 * Role management endpoints.
 *
 * GET  - List all roles
 * POST - Create new role (super_admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import {
  validateBody,
  success,
  created,
  serverError,
  conflict,
} from '@/lib/utils';
import { z } from 'zod';

/**
 * Role creation schema
 */
const createRoleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  description: z.string().max(255).optional(),
});

/**
 * GET /api/roles
 *
 * List all roles with their permissions.
 * Requires roles:list permission.
 */
export const GET = withPermission(
  { resource: 'roles', action: 'list' },
  async (): Promise<NextResponse> => {
    try {
      const roles = await prisma.role.findMany({
        orderBy: { name: 'asc' },
        include: {
          rolePermissions: {
            include: {
              permission: {
                select: {
                  id: true,
                  resource: true,
                  action: true,
                  description: true,
                },
              },
            },
          },
          _count: {
            select: {
              userRoles: true,
            },
          },
        },
      });

      const data = roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: role.rolePermissions.map((rp) => rp.permission),
        userCount: role._count.userRoles,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      }));

      return success({ data });

    } catch (error) {
      console.error('Failed to list roles:', error);
      return serverError('Failed to retrieve roles');
    }
  }
);

/**
 * POST /api/roles
 *
 * Create a new role.
 * Only super_admin can create roles.
 */
export const POST = withPermission(
  { resource: 'roles', action: 'create' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Only super_admin can create roles
      const currentUserRoles = context.auth.roles || [];
      if (!currentUserRoles.includes('super_admin')) {
        return NextResponse.json(
          { error: 'Only super_admin can create roles' },
          { status: 403 }
        );
      }

      // Validate request body
      const validation = await validateBody(request, createRoleSchema);
      if (!validation.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: validation.error.flatten() },
          { status: 400 }
        );
      }

      const { name, description } = validation.data;

      // Check if role already exists
      const existingRole = await prisma.role.findUnique({
        where: { name },
      });

      if (existingRole) {
        return conflict('Role with this name already exists');
      }

      // Create role
      const role = await prisma.role.create({
        data: {
          name,
          description,
          isSystem: false,
        },
      });

      // Audit log
      await logCreate(context, 'roles', role.id, { name, description });

      return created({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        createdAt: role.createdAt,
      });

    } catch (error) {
      console.error('Failed to create role:', error);
      return serverError('Failed to create role');
    }
  }
);
