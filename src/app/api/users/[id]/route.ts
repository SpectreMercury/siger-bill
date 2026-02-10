/**
 * /api/users/[id]
 *
 * Single user management endpoints.
 *
 * GET    - Get user details
 * PUT    - Update user
 * DELETE - Deactivate user
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission, ExtendedRequestContext } from '@/lib/middleware';
import { logUpdate, logDelete } from '@/lib/audit';
import {
  validateBody,
  success,
  notFound,
  serverError,
} from '@/lib/utils';
import { z } from 'zod';

/**
 * User update schema
 */
const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
});

/**
 * GET /api/users/[id]
 *
 * Get a single user's details.
 */
export const GET = withPermission(
  { resource: 'users', action: 'read' },
  async (_request: NextRequest, context: ExtendedRequestContext): Promise<NextResponse> => {
    try {
      const id = context.params.id;

      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          userRoles: {
            include: {
              role: {
                select: {
                  id: true,
                  name: true,
                  description: true,
                },
              },
            },
          },
          userScopes: {
            select: {
              id: true,
              scopeType: true,
              scopeId: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              auditLogs: true,
              invoiceRuns: true,
            },
          },
        },
      });

      if (!user) {
        return notFound('User not found');
      }

      return success({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        roles: user.userRoles.map((ur) => ur.role),
        scopes: user.userScopes,
        _count: user._count,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });

    } catch (error) {
      console.error('Failed to get user:', error);
      return serverError('Failed to retrieve user');
    }
  }
);

/**
 * PUT /api/users/[id]
 *
 * Update a user.
 */
export const PUT = withPermission(
  { resource: 'users', action: 'update' },
  async (request: NextRequest, context: ExtendedRequestContext): Promise<NextResponse> => {
    try {
      const id = context.params.id;

      // Validate request body
      const validation = await validateBody(request, updateUserSchema);
      if (!validation.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: validation.error.flatten() },
          { status: 400 }
        );
      }

      const existing = await prisma.user.findUnique({
        where: { id },
        include: {
          userRoles: {
            include: { role: true },
          },
        },
      });

      if (!existing) {
        return notFound('User not found');
      }

      const { firstName, lastName, isActive, roleIds } = validation.data;

      // If updating roles, check permissions
      if (roleIds !== undefined) {
        // Check if trying to assign admin roles
        const adminRoles = await prisma.role.findMany({
          where: {
            id: { in: roleIds },
            name: { in: ['super_admin', 'admin'] },
          },
        });

        if (adminRoles.length > 0) {
          const currentUserRoles = context.auth.roles || [];
          if (!currentUserRoles.includes('super_admin')) {
            return NextResponse.json(
              { error: 'Only super_admin can assign admin roles' },
              { status: 403 }
            );
          }
        }
      }

      // Update user
      const user = await prisma.$transaction(async (tx) => {
        // Update user data
        const updatedUser = await tx.user.update({
          where: { id },
          data: {
            ...(firstName && { firstName }),
            ...(lastName && { lastName }),
            ...(isActive !== undefined && { isActive }),
          },
        });

        // Update roles if provided
        if (roleIds !== undefined) {
          // Remove existing roles
          await tx.userRole.deleteMany({
            where: { userId: id },
          });

          // Add new roles
          if (roleIds.length > 0) {
            await tx.userRole.createMany({
              data: roleIds.map((roleId) => ({ userId: id, roleId })),
            });
          }
        }

        // Fetch updated user with roles
        return tx.user.findUnique({
          where: { id },
          include: {
            userRoles: {
              include: {
                role: {
                  select: {
                    id: true,
                    name: true,
                    description: true,
                  },
                },
              },
            },
          },
        });
      });

      // Audit log
      await logUpdate(
        context,
        'users',
        id,
        { ...existing, roles: existing.userRoles.map((ur) => ur.role.name) } as unknown as Record<string, unknown>,
        { ...user, roles: user!.userRoles.map((ur) => ur.role.name) } as unknown as Record<string, unknown>
      );

      return success({
        id: user!.id,
        email: user!.email,
        firstName: user!.firstName,
        lastName: user!.lastName,
        isActive: user!.isActive,
        roles: user!.userRoles.map((ur) => ur.role),
        updatedAt: user!.updatedAt,
      });

    } catch (error) {
      console.error('Failed to update user:', error);
      return serverError('Failed to update user');
    }
  }
);

/**
 * DELETE /api/users/[id]
 *
 * Deactivate a user (soft delete).
 */
export const DELETE = withPermission(
  { resource: 'users', action: 'delete' },
  async (_request: NextRequest, context: ExtendedRequestContext): Promise<NextResponse> => {
    try {
      const id = context.params.id;

      const existing = await prisma.user.findUnique({
        where: { id },
      });

      if (!existing) {
        return notFound('User not found');
      }

      // Prevent deleting yourself
      if (id === context.auth.userId) {
        return NextResponse.json(
          { error: 'Cannot deactivate your own account' },
          { status: 400 }
        );
      }

      // Soft delete - set isActive to false
      await prisma.user.update({
        where: { id },
        data: { isActive: false },
      });

      // Audit log
      await logDelete(context, 'users', id, existing as unknown as Record<string, unknown>);

      return success({ message: 'User deactivated' });

    } catch (error) {
      console.error('Failed to delete user:', error);
      return serverError('Failed to delete user');
    }
  }
);
