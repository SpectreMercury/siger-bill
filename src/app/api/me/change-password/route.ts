/**
 * /api/me/change-password
 *
 * User self-service password change endpoint.
 *
 * POST - Change own password
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { AuditAction } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  validateBody,
  success,
  serverError,
} from '@/lib/utils';
import { z } from 'zod';

/**
 * Password change schema
 */
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

/**
 * POST /api/me/change-password
 *
 * Change the current user's password.
 * Requires current password verification.
 */
export const POST = withAuth(
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Validate request body
      const validation = await validateBody(request, changePasswordSchema);
      if (!validation.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: validation.error.flatten() },
          { status: 400 }
        );
      }

      const { currentPassword, newPassword } = validation.data;

      // Get user with current password hash
      const user = await prisma.user.findUnique({
        where: { id: context.auth.userId },
        select: { id: true, email: true, passwordHash: true },
      });

      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }

      // Verify current password
      const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isCurrentValid) {
        return NextResponse.json(
          { error: 'Current password is incorrect' },
          { status: 400 }
        );
      }

      // Check that new password is different from current
      const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
      if (isSamePassword) {
        return NextResponse.json(
          { error: 'New password must be different from current password' },
          { status: 400 }
        );
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      // Update password
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newPasswordHash },
      });

      // Audit log
      await logAuditEvent(context, {
        action: AuditAction.UPDATE,
        targetTable: 'users',
        targetId: user.id,
        afterData: { passwordChanged: true, selfService: true },
      });

      return success({ message: 'Password changed successfully' });

    } catch (error) {
      console.error('Failed to change password:', error);
      return serverError('Failed to change password');
    }
  }
);
