/**
 * Audit Logging Service
 *
 * Provides comprehensive audit logging for all system activities.
 * All sensitive operations must be logged for compliance with
 * Google Cloud Reseller audit requirements.
 */

import { prisma } from '@/lib/db';
import { AuditAction, Prisma } from '@prisma/client';
import { RequestContext } from '@/lib/types';

/**
 * Audit log entry parameters
 */
interface AuditLogParams {
  action: AuditAction;
  targetTable: string;
  targetId?: string;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Log an audit event using request context
 */
export async function logAuditEvent(
  context: RequestContext,
  params: AuditLogParams
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: context.auth.userId,
        action: params.action,
        targetTable: params.targetTable,
        targetId: params.targetId,
        beforeData: params.beforeData ? (params.beforeData as Prisma.InputJsonValue) : Prisma.JsonNull,
        afterData: params.afterData ? (params.afterData as Prisma.InputJsonValue) : Prisma.JsonNull,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          requestId: context.requestId,
          ...(params.metadata || {}),
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    // Log to console but don't fail the request
    console.error('Failed to write audit log:', error);
  }
}

/**
 * Log an audit event with minimal context (e.g., for login events before auth context exists)
 */
export async function logAuditEventMinimal(params: {
  actorId: string | null;
  action: AuditAction;
  targetTable: string;
  targetId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        targetTable: params.targetTable,
        targetId: params.targetId,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

/**
 * Log a CREATE operation
 */
export async function logCreate(
  context: RequestContext,
  targetTable: string,
  targetId: string,
  data: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.CREATE,
    targetTable,
    targetId,
    afterData: sanitizeForAudit(data),
  });
}

/**
 * Log an UPDATE operation
 */
export async function logUpdate(
  context: RequestContext,
  targetTable: string,
  targetId: string,
  beforeData: Record<string, unknown>,
  afterData: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.UPDATE,
    targetTable,
    targetId,
    beforeData: sanitizeForAudit(beforeData),
    afterData: sanitizeForAudit(afterData),
  });
}

/**
 * Log a DELETE operation
 */
export async function logDelete(
  context: RequestContext,
  targetTable: string,
  targetId: string,
  data: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.DELETE,
    targetTable,
    targetId,
    beforeData: sanitizeForAudit(data),
  });
}

/**
 * Log a LOGIN event
 */
export async function logLogin(
  userId: string,
  email: string,
  ipAddress: string | null,
  userAgent: string | null,
  success: boolean
): Promise<void> {
  return logAuditEventMinimal({
    actorId: success ? userId : null,
    action: AuditAction.LOGIN,
    targetTable: 'users',
    targetId: userId,
    ipAddress,
    userAgent,
    metadata: { email, success },
  });
}

/**
 * Log a LOGOUT event
 */
export async function logLogout(
  context: RequestContext
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.LOGOUT,
    targetTable: 'users',
    targetId: context.auth.userId,
  });
}

/**
 * Log an EXPORT operation
 */
export async function logExport(
  context: RequestContext,
  targetTable: string,
  metadata: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.EXPORT,
    targetTable,
    metadata,
  });
}

/**
 * Log invoice run events
 */
export async function logInvoiceRunStart(
  context: RequestContext,
  invoiceRunId: string,
  billingMonth: string
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.INVOICE_RUN_START,
    targetTable: 'invoice_runs',
    targetId: invoiceRunId,
    metadata: { billingMonth },
  });
}

export async function logInvoiceRunComplete(
  context: RequestContext,
  invoiceRunId: string,
  status: string,
  totalInvoices?: number,
  totalAmount?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.INVOICE_RUN_COMPLETE,
    targetTable: 'invoice_runs',
    targetId: invoiceRunId,
    metadata: { status, totalInvoices, totalAmount, ...metadata },
  });
}

/**
 * Log invoice run failure (Phase 2.6)
 * Captures detailed error information for audit trail
 */
export async function logInvoiceRunFailed(
  context: RequestContext,
  invoiceRunId: string,
  errorMessage: string,
  errorDetails?: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.INVOICE_RUN_COMPLETE, // Using same action type with FAILED status
    targetTable: 'invoice_runs',
    targetId: invoiceRunId,
    metadata: {
      status: 'FAILED',
      errorMessage,
      errorDetails,
    },
  });
}

/**
 * Log invoice locking
 */
export async function logInvoiceLock(
  context: RequestContext,
  invoiceId: string
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.INVOICE_LOCK,
    targetTable: 'invoices',
    targetId: invoiceId,
  });
}

/**
 * Log permission changes
 */
export async function logPermissionChange(
  context: RequestContext,
  targetUserId: string,
  changeType: 'role_assigned' | 'role_removed' | 'scope_added' | 'scope_removed',
  details: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.PERMISSION_CHANGE,
    targetTable: 'users',
    targetId: targetUserId,
    metadata: { changeType, ...details },
  });
}

// ============================================================================
// Phase 3.3: Credit Audit Logging
// ============================================================================

/**
 * Log credit creation
 */
export async function logCreditCreate(
  context: RequestContext,
  creditId: string,
  customerId: string,
  data: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.CREDIT_CREATE,
    targetTable: 'credits',
    targetId: creditId,
    afterData: { customerId, ...data },
  });
}

/**
 * Log credit update
 */
export async function logCreditUpdate(
  context: RequestContext,
  creditId: string,
  beforeData: Record<string, unknown>,
  afterData: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.CREDIT_UPDATE,
    targetTable: 'credits',
    targetId: creditId,
    beforeData,
    afterData,
  });
}

/**
 * Log credit application to invoice
 */
export async function logCreditApply(
  context: RequestContext,
  creditId: string,
  invoiceId: string,
  appliedAmount: string,
  metadata: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.CREDIT_APPLY,
    targetTable: 'credit_ledger',
    targetId: creditId,
    metadata: {
      invoiceId,
      appliedAmount,
      ...metadata,
    },
  });
}

// ============================================================================
// Phase 3.5: Special Rule Audit Logging
// ============================================================================

/**
 * Log special rule creation
 */
export async function logSpecialRuleCreate(
  context: RequestContext,
  ruleId: string,
  customerId: string | null,
  data: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.SPECIAL_RULE_CREATE,
    targetTable: 'special_rules',
    targetId: ruleId,
    afterData: { customerId, ...data },
  });
}

/**
 * Log special rule update
 */
export async function logSpecialRuleUpdate(
  context: RequestContext,
  ruleId: string,
  beforeData: Record<string, unknown>,
  afterData: Record<string, unknown>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.SPECIAL_RULE_UPDATE,
    targetTable: 'special_rules',
    targetId: ruleId,
    beforeData,
    afterData,
  });
}

/**
 * Log special rule deletion (soft delete)
 */
export async function logSpecialRuleDelete(
  context: RequestContext,
  ruleId: string,
  ruleName: string
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.SPECIAL_RULE_DELETE,
    targetTable: 'special_rules',
    targetId: ruleId,
    beforeData: { name: ruleName, deletedAt: null },
    afterData: { deletedAt: new Date().toISOString() },
  });
}

/**
 * Log special rule application during invoice run
 */
export async function logSpecialRuleApply(
  context: RequestContext,
  invoiceRunId: string,
  rulesApplied: Array<{
    ruleId: string;
    ruleName: string;
    affectedRowCount: number;
    costDelta: string;
  }>
): Promise<void> {
  return logAuditEvent(context, {
    action: AuditAction.SPECIAL_RULE_APPLY,
    targetTable: 'special_rule_effect_ledger',
    targetId: invoiceRunId,
    metadata: {
      rulesApplied,
      totalRules: rulesApplied.length,
    },
  });
}

// ============================================================================
// Phase 6: Invoice Export Audit Logging
// ============================================================================

/**
 * Simple audit log creation without request context
 * Used for direct logging when RequestContext is not available
 */
export async function createAuditLog(params: {
  actorId: string;
  action: AuditAction;
  targetTable: string;
  targetId?: string;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        targetTable: params.targetTable,
        targetId: params.targetId,
        beforeData: params.beforeData ? (params.beforeData as Prisma.InputJsonValue) : Prisma.JsonNull,
        afterData: params.afterData ? (params.afterData as Prisma.InputJsonValue) : Prisma.JsonNull,
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

/**
 * Log invoice export
 */
export async function logInvoiceExport(
  actorId: string,
  invoiceId: string,
  exportDetails: {
    exportId: string;
    format: string;
    contentHash: string;
    filename: string;
    fileSize: number;
    invoiceNumber: string;
    customerId: string;
  }
): Promise<void> {
  return createAuditLog({
    actorId,
    action: AuditAction.INVOICE_EXPORT,
    targetTable: 'invoices',
    targetId: invoiceId,
    afterData: exportDetails,
    metadata: {
      invoiceNumber: exportDetails.invoiceNumber,
      customerId: exportDetails.customerId,
    },
  });
}

/**
 * Remove sensitive fields from data before storing in audit log
 */
function sanitizeForAudit(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = ['password', 'passwordHash', 'password_hash', 'token', 'secret'];
  const sanitized = { ...data };

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}
