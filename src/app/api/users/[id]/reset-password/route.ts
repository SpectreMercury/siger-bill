/**
 * /api/users/[id]/reset-password
 *
 * Password reset endpoint.
 *
 * POST - Reset user password
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission, ExtendedRequestContext } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { AuditAction } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  validateBody,
  success,
  notFound,
  serverError,
} from '@/lib/utils';
import { z } from 'zod';

/**
 * Password reset schema
 */
const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

/**
 * POST /api/users/[id]/reset-password
 *
 * Reset a user's password.
 * Requires users:update permission.
 */
export const POST = withPermission(
  { resource: 'users', action: 'update' },
  async (request: NextRequest, context: ExtendedRequestContext): Promise<NextResponse> => {
    try {
      const id = context.params.id;

      // Validate request body
      const validation = await validateBody(request, resetPasswordSchema);
      if (!validation.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: validation.error.flatten() },
          { status: 400 }
        );
      }

      const existing = await prisma.user.findUnique({
        where: { id },
      });

      if (!existing) {
        return notFound('User not found');
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(validation.data.newPassword, 12);

      // Update password
      await prisma.user.update({
        where: { id },
        data: { passwordHash },
      });

      // Audit log
      await logAuditEvent(context, {
        action: AuditAction.UPDATE,
        targetTable: 'users',
        targetId: id,
        afterData: { passwordReset: true, resetBy: context.auth.userId },
      });

      return success({ message: 'Password reset successfully' });

    } catch (error) {
      console.error('Failed to reset password:', error);
      return serverError('Failed to reset password');
    }
  }
);
