/**
 * GET /api/me
 *
 * Returns the currently authenticated user's profile and permissions.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware';
import { success } from '@/lib/utils';

export const GET = withAuth(async (_request, context): Promise<NextResponse> => {
  const { auth } = context;

  return success({
    user: {
      id: auth.userId,
      email: auth.email,
      firstName: auth.firstName,
      lastName: auth.lastName,
      isActive: auth.isActive,
      roles: auth.roles,
      permissions: Array.from(auth.permissions),
      scopes: auth.scopes,
      isSuperAdmin: auth.isSuperAdmin,
    },
  });
});
