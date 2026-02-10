/**
 * /api/users
 *
 * User management endpoints.
 *
 * GET  - List all users
 * POST - Create new user
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import bcrypt from 'bcryptjs';
import {
  validateBody,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  conflict,
} from '@/lib/utils';
import { z } from 'zod';

/**
 * User creation schema
 */
const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  roleIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().default(true),
});

/**
 * GET /api/users
 *
 * List all users with pagination.
 * Requires users:list permission.
 */
export const GET = withPermission(
  { resource: 'users', action: 'list' },
  async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);

      // Parse pagination
      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });

      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 20;
      const skip = (page - 1) * limit;

      // Optional filters
      const search = searchParams.get('search');
      const isActive = searchParams.get('isActive');

      // Build where clause
      const where: Record<string, unknown> = {};

      if (search) {
        where.OR = [
          { email: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (isActive !== null && isActive !== undefined) {
        where.isActive = isActive === 'true';
      }

      // Execute queries in parallel
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
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
              },
            },
          },
        }),
        prisma.user.count({ where }),
      ]);

      // Transform response (exclude password hash)
      const data = users.map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        roles: user.userRoles.map((ur) => ur.role),
        scopes: user.userScopes,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }));

      return success({
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });

    } catch (error) {
      console.error('Failed to list users:', error);
      return serverError('Failed to retrieve users');
    }
  }
);

/**
 * POST /api/users
 *
 * Create a new user.
 * Requires users:create permission.
 * Only super_admin can create admin users.
 */
export const POST = withPermission(
  { resource: 'users', action: 'create' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Validate request body
      const validation = await validateBody(request, createUserSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { email, firstName, lastName, password, roleIds, isActive } = validation.data;

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        return conflict('User with this email already exists');
      }

      // If assigning admin roles, check if current user is super_admin
      if (roleIds && roleIds.length > 0) {
        const adminRoles = await prisma.role.findMany({
          where: {
            id: { in: roleIds },
            name: { in: ['super_admin', 'admin'] },
          },
        });

        if (adminRoles.length > 0) {
          // Check if current user is super_admin
          const currentUserRoles = context.auth.roles || [];
          if (!currentUserRoles.includes('super_admin')) {
            return NextResponse.json(
              { error: 'Only super_admin can assign admin roles' },
              { status: 403 }
            );
          }
        }
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create user with roles
      const user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          firstName,
          lastName,
          passwordHash,
          isActive,
          userRoles: roleIds && roleIds.length > 0 ? {
            create: roleIds.map((roleId) => ({ roleId })),
          } : undefined,
        },
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

      // Audit log
      await logCreate(context, 'users', user.id, {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.userRoles.map((ur) => ur.role.name),
      });

      return created({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        roles: user.userRoles.map((ur) => ur.role),
        createdAt: user.createdAt,
      });

    } catch (error) {
      console.error('Failed to create user:', error);
      return serverError('Failed to create user');
    }
  }
);
