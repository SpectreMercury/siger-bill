/**
 * /api/invoices/:id/export
 *
 * Invoice export endpoint (Phase 6).
 *
 * GET - Export invoice in specified format (csv, xlsx, pdf)
 *
 * Query params:
 * - format: 'csv' | 'xlsx' | 'pdf' (required)
 * - aggregation: 'product_group' | 'provider' | 'service' | 'sku' (optional, default: product_group)
 * - includeRaw: 'true' | 'false' (optional, for xlsx)
 * - includeCredits: 'true' | 'false' (optional, for xlsx)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermissionAndScope, ExtendedRequestContext } from '@/lib/middleware';
import { notFound, badRequest } from '@/lib/utils';
import {
  buildInvoicePresentation,
  getCreditsBreakdown,
  getPricingBreakdown,
  exportToCSV,
  exportToXLSX,
  exportToPDF,
  ExportFormat,
  AggregationLevel,
} from '@/lib/invoice-presentation';
import { createAuditLog } from '@/lib/audit/logger';
import { AuditAction } from '@prisma/client';

/**
 * GET /api/invoices/:id/export?format=csv|xlsx|pdf
 *
 * Export invoice in the specified format.
 * Requires invoices:read permission and customer scope.
 * Invoice must be locked before export.
 */
export const GET = withPermissionAndScope(
  { resource: 'invoices', action: 'read' },
  async (_request, routeParams) => {
    const invoiceId = routeParams?.params.id;
    if (!invoiceId) return null;
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { customerId: true },
    });
    return invoice?.customerId ?? null;
  },
  async (request: NextRequest, context: ExtendedRequestContext): Promise<NextResponse> => {
    const invoiceId = context.params.id;
    const userId = context.auth.userId;

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const format = searchParams.get('format') as ExportFormat | null;
    const aggregation = (searchParams.get('aggregation') || 'product_group') as AggregationLevel;
    const includeRaw = searchParams.get('includeRaw') === 'true';
    const includeCredits = searchParams.get('includeCredits') !== 'false'; // Default true

    // Validate format
    if (!format || !['csv', 'xlsx', 'pdf'].includes(format)) {
      return badRequest('Invalid or missing format. Must be one of: csv, xlsx, pdf');
    }

    // Validate aggregation level
    if (!['product_group', 'provider', 'service', 'sku'].includes(aggregation)) {
      return badRequest('Invalid aggregation level. Must be one of: product_group, provider, service, sku');
    }

    // Check invoice exists and is locked
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        lockedAt: true,
        status: true,
        customerId: true,
      },
    });

    if (!invoice) {
      return notFound('Invoice not found');
    }

    // Enforce locking requirement
    if (!invoice.lockedAt) {
      return badRequest('Invoice must be locked before export. Lock the invoice first using POST /api/invoices/:id/lock');
    }

    try {
      // Build presentation
      const presentation = await buildInvoicePresentation(invoiceId, aggregation);

      // Get optional breakdowns
      const creditsBreakdown = includeCredits ? await getCreditsBreakdown(invoiceId) : undefined;
      const pricingBreakdown = await getPricingBreakdown(invoiceId);

      // Export based on format
      let result;
      switch (format) {
        case 'csv':
          result = exportToCSV(presentation, {
            format: 'csv',
            aggregationLevel: aggregation,
            includeRawItems: includeRaw,
          });
          break;

        case 'xlsx':
          result = exportToXLSX(
            presentation,
            {
              format: 'xlsx',
              aggregationLevel: aggregation,
              includeRawItems: includeRaw,
              includeCreditsBreakdown: includeCredits,
            },
            creditsBreakdown,
            pricingBreakdown ?? undefined
          );
          break;

        case 'pdf':
          result = exportToPDF(
            presentation,
            { format: 'pdf' },
            creditsBreakdown
          );
          break;

        default:
          return badRequest('Unsupported format');
      }

      // Record export in database
      const exportRecord = await prisma.invoiceExport.create({
        data: {
          invoiceId,
          format,
          contentHash: result.contentHash,
          filename: result.filename,
          fileSize: result.content.length,
          mimeType: result.mimeType,
          exportConfig: {
            aggregationLevel: aggregation,
            includeRaw,
            includeCredits,
          },
          exportedBy: userId!,
        },
      });

      // Log audit event
      await createAuditLog({
        actorId: userId!,
        action: AuditAction.INVOICE_EXPORT,
        targetTable: 'invoices',
        targetId: invoiceId,
        afterData: {
          exportId: exportRecord.id,
          format,
          contentHash: result.contentHash,
          filename: result.filename,
          fileSize: result.content.length,
        },
        metadata: {
          customerId: invoice.customerId,
          invoiceNumber: invoice.invoiceNumber,
        },
      });

      // Return file response
      const headers = new Headers();
      headers.set('Content-Type', result.mimeType);
      headers.set('Content-Disposition', `attachment; filename="${result.filename}"`);
      headers.set('Content-Length', result.content.length.toString());
      headers.set('X-Content-Hash', result.contentHash);
      headers.set('X-Export-Id', exportRecord.id);

      // Convert Buffer to Uint8Array for NextResponse compatibility
      return new NextResponse(new Uint8Array(result.content), {
        status: 200,
        headers,
      });
    } catch (error) {
      console.error('Export error:', error);
      return NextResponse.json(
        { error: 'Export failed', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }
  }
);
