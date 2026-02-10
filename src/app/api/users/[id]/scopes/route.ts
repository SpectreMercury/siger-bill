/**
 * /api/users/[id]/scopes
 *
 * User scope management endpoints.
 *
 * GET    - List user scopes
 * POST   - Add scope to user
 * DELETE - Remove scope from user
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission, ExtendedRequestContext } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { AuditAction, ScopeType } from '@prisma/client';
import {
  validateBody,
  success,
  created,
  notFound,
  serverError,
  conflict,
} from '@/lib/utils';
import { z } from 'zod';

/**
 * Scope creation schema
 */
const addScopeSchema = z.object({
  scopeType: z.enum(['CUSTOMER', 'BILLING', 'PROJECT']),
  scopeId: z.string().uuid(),
});

/**
 * GET /api/users/[id]/scopes
 *
 * List all scopes for a user.
 */
export const GET = withPermission(
  { resource: 'users', action: 'read' },
  async (_request: NextRequest, context: ExtendedRequestContext): Promise<NextResponse> => {
    try {
      const id = context.params.id;

      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!user) {
        return notFound('User not found');
      }

      const scopes = await prisma.userScope.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
      });

      // Enrich with scope details
      const enrichedScopes = await Promise.all(
        scopes.map(async (scope) => {
          let scopeDetails: { name?: string; externalId?: string } = {};

          if (scope.scopeType === ScopeType.CUSTOMER) {
            const customer = await prisma.customer.findUnique({
              where: { id: scope.scopeId },
              select: { name: true, externalId: true },
            });
            if (customer) {
              scopeDetails = { name: customer.name, externalId: customer.externalId || undefined };
            }
          }

          return {
            id: scope.id,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
            ...scopeDetails,
            createdAt: scope.createdAt,
          };
        })
      );

      return success({ data: enrichedScopes });

    } catch (error) {
      console.error('Failed to list user scopes:', error);
      return serverError('Failed to retrieve user scopes');
    }
  }
);

/**
 * POST /api/users/[id]/scopes
 *
 * Add a scope to a user.
 */
export const POST = withPermission(
  { resource: 'users', action: 'update' },
  async (request: NextRequest, context: ExtendedRequestContext): Promise<NextResponse> => {
    try {
      const id = context.params.id;

      // Validate request body
      const validation = await validateBody(request, addScopeSchema);
      if (!validation.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: validation.error.flatten() },
          { status: 400 }
        );
      }

      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!user) {
        return notFound('User not found');
      }

      const { scopeType, scopeId } = validation.data;

      // Verify the scope target exists
      if (scopeType === 'CUSTOMER') {
        const customer = await prisma.customer.findUnique({
          where: { id: scopeId },
        });
        if (!customer) {
          return notFound('Customer not found');
        }
      }

      // Check for duplicate
      const existingScope = await prisma.userScope.findFirst({
        where: { userId: id, scopeType, scopeId },
      });

      if (existingScope) {
        return conflict('Scope already assigned to user');
      }

      // Create scope
      const scope = await prisma.userScope.create({
        data: {
          userId: id,
          scopeType,
          scopeId,
        },
      });

      // Audit log
      await logAuditEvent(context, {
        action: AuditAction.BIND,
        targetTable: 'user_scopes',
        targetId: scope.id,
        afterData: { userId: id, scopeType, scopeId },
      });

      return created({
        id: scope.id,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        createdAt: scope.createdAt,
      });

    } catch (error) {
      console.error('Failed to add user scope:', error);
      return serverError('Failed to add user scope');
    }
  }
);

/**
 * DELETE /api/users/[id]/scopes
 *
 * Remove a scope from a user.
 * Body: { scopeId: string }
 */
export const DELETE = withPermission(
  { resource: 'users', action: 'update' },
  async (request: NextRequest, context: ExtendedRequestContext): Promise<NextResponse> => {
    try {
      const id = context.params.id;

      const body = await request.json();
      const userScopeId = body.scopeId;

      if (!userScopeId) {
        return NextResponse.json(
          { error: 'scopeId is required' },
          { status: 400 }
        );
      }

      const scope = await prisma.userScope.findFirst({
        where: { id: userScopeId, userId: id },
      });

      if (!scope) {
        return notFound('Scope not found');
      }

      // Delete scope
      await prisma.userScope.delete({
        where: { id: userScopeId },
      });

      // Audit log
      await logAuditEvent(context, {
        action: AuditAction.UNBIND,
        targetTable: 'user_scopes',
        targetId: userScopeId,
        beforeData: { userId: id, scopeType: scope.scopeType, scopeId: scope.scopeId },
      });

      return success({ message: 'Scope removed' });

    } catch (error) {
      console.error('Failed to remove user scope:', error);
      return serverError('Failed to remove user scope');
    }
  }
);
