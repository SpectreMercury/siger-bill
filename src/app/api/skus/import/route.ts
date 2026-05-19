/**
 * POST /api/skus/import
 *
 * Excel-based bulk import of SKUs + SKU Groups + their mappings.
 *
 * Accepts multipart/form-data with a single `file` field (xlsx/xls).
 * Expected columns (Chinese or English aliases tolerated):
 *   服务说明         | serviceDescription
 *   服务 ID / 服务ID | serviceId
 *   SKU ID           | skuId
 *   SKU 说明 / SKU说明 | skuDescription
 *   SKUGROUP         | skuGroup
 *
 * De-duplication is two-layered:
 *   1. In-file: collapsed by Map keyed on skuId / group code / (skuId, code)
 *   2. Cross-run: createMany({ skipDuplicates: true }) relies on the unique
 *      constraints `skus.sku_id`, `sku_groups.code`,
 *      `sku_group_mappings(sku_id, sku_group_id)`.
 *
 * Re-running the same file yields 0 inserts.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { AuditAction } from '@prisma/client';
import { badRequest, serverError, success } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min for big imports

const HEADER_ALIASES: Record<string, string> = {
  '服务说明': 'serviceDescription',
  'servicedescription': 'serviceDescription',
  'service description': 'serviceDescription',
  '服务 id': 'serviceId',
  '服务id': 'serviceId',
  'serviceid': 'serviceId',
  'service id': 'serviceId',
  'sku id': 'skuId',
  'skuid': 'skuId',
  'sku 说明': 'skuDescription',
  'sku说明': 'skuDescription',
  'skudescription': 'skuDescription',
  'sku description': 'skuDescription',
  'skugroup': 'skuGroup',
  'sku group': 'skuGroup',
  'sku_group': 'skuGroup',
};

const REQUIRED_KEYS = [
  'serviceDescription',
  'serviceId',
  'skuId',
  'skuDescription',
  'skuGroup',
] as const;

type Normalized = {
  serviceDescription: string;
  serviceId: string;
  skuId: string;
  skuDescription: string;
  skuGroup: string;
};

function normalizeHeader(raw: string): string | null {
  const k = raw.trim().toLowerCase();
  return HEADER_ALIASES[k] ?? null;
}

const CHUNK_SIZE = 1000;

async function chunkedCreateMany<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<{ count: number }>
): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { count } = await insert(chunk);
    total += count;
  }
  return total;
}

export const POST = withPermission(
  { resource: 'skus', action: 'import' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const form = await request.formData();
      const file = form.get('file');

      if (!(file instanceof File)) {
        return badRequest('Missing "file" field (multipart/form-data)');
      }

      if (file.size === 0) {
        return badRequest('Uploaded file is empty');
      }

      const buf = Buffer.from(await file.arrayBuffer());

      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(buf, { type: 'buffer' });
      } catch {
        return badRequest('Failed to parse file as Excel');
      }

      if (workbook.SheetNames.length === 0) {
        return badRequest('Workbook has no sheets');
      }

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
        raw: false,
      });

      if (rawRows.length === 0) {
        return badRequest('Sheet is empty');
      }

      // --- Header mapping ---
      const firstRow = rawRows[0];
      const headerMap = new Map<string, string>(); // raw header -> canonical key
      for (const rawHeader of Object.keys(firstRow)) {
        const canonical = normalizeHeader(rawHeader);
        if (canonical) headerMap.set(rawHeader, canonical);
      }

      const presentKeys = new Set<string>(Array.from(headerMap.values()));
      const missingKeys = REQUIRED_KEYS.filter((k) => !presentKeys.has(k));
      if (missingKeys.length > 0) {
        return badRequest(
          `Excel is missing required columns: ${missingKeys.join(', ')}`,
          { detectedHeaders: Object.keys(firstRow), missing: missingKeys }
        );
      }

      // --- Row validation + in-file dedup ---
      const skuMap = new Map<string, Normalized>(); // skuId -> full row
      const groupSet = new Set<string>(); // distinct group codes
      const mappingPairs = new Set<string>(); // "skuId\x1Fcode"
      const errors: Array<{ row: number; reason: string }> = [];

      rawRows.forEach((row, idx) => {
        const rowNum = idx + 2; // header is row 1
        const normalized: Partial<Normalized> = {};
        headerMap.forEach((canonical, rawHeader) => {
          const v = row[rawHeader];
          if (v != null) {
            const s = String(v).trim();
            if (s.length > 0) (normalized as Record<string, string>)[canonical] = s;
          }
        });
        for (const k of REQUIRED_KEYS) {
          if (!(normalized as Record<string, string>)[k]) {
            errors.push({ row: rowNum, reason: `Missing "${k}"` });
            return;
          }
        }
        const n = normalized as Normalized;
        skuMap.set(n.skuId, n);
        groupSet.add(n.skuGroup);
        mappingPairs.add(`${n.skuId}\x1F${n.skuGroup}`);
      });

      if (skuMap.size === 0) {
        return badRequest('No valid rows after validation', { errors });
      }

      // --- Insert sku_groups ---
      const groupRows = Array.from(groupSet).map((code) => ({
        code,
        name: code, // Excel has no separate display name; reuse code
        description: null as string | null,
      }));
      const groupsAdded = await chunkedCreateMany(groupRows, (chunk) =>
        prisma.skuGroup.createMany({ data: chunk, skipDuplicates: true })
      );

      // --- Insert skus ---
      const skuRows = Array.from(skuMap.values()).map((s) => ({
        skuId: s.skuId,
        skuDescription: s.skuDescription,
        serviceId: s.serviceId,
        serviceDescription: s.serviceDescription,
      }));
      const skusAdded = await chunkedCreateMany(skuRows, (chunk) =>
        prisma.sku.createMany({ data: chunk, skipDuplicates: true })
      );

      // --- Resolve UUIDs for mapping inserts ---
      const skuIdToUuid = new Map<string, string>();
      const codeToUuid = new Map<string, string>();

      // Fetch in chunks to avoid huge IN-lists
      const skuIdsArr = Array.from(skuMap.keys());
      for (let i = 0; i < skuIdsArr.length; i += CHUNK_SIZE) {
        const chunk = skuIdsArr.slice(i, i + CHUNK_SIZE);
        const found = await prisma.sku.findMany({
          where: { skuId: { in: chunk } },
          select: { id: true, skuId: true },
        });
        found.forEach((s) => skuIdToUuid.set(s.skuId, s.id));
      }

      const codesArr = Array.from(groupSet);
      for (let i = 0; i < codesArr.length; i += CHUNK_SIZE) {
        const chunk = codesArr.slice(i, i + CHUNK_SIZE);
        const found = await prisma.skuGroup.findMany({
          where: { code: { in: chunk } },
          select: { id: true, code: true },
        });
        found.forEach((g) => codeToUuid.set(g.code, g.id));
      }

      // --- Insert sku_group_mappings ---
      const mappingRows: Array<{ skuId: string; skuGroupId: string }> = [];
      const orphanPairs: Array<{ skuId: string; code: string }> = [];
      for (const pair of Array.from(mappingPairs)) {
        const [skuId, code] = pair.split('\x1F');
        const sUuid = skuIdToUuid.get(skuId);
        const gUuid = codeToUuid.get(code);
        if (sUuid && gUuid) {
          mappingRows.push({ skuId: sUuid, skuGroupId: gUuid });
        } else {
          orphanPairs.push({ skuId, code });
        }
      }
      const mappingsAdded = await chunkedCreateMany(mappingRows, (chunk) =>
        prisma.skuGroupMapping.createMany({ data: chunk, skipDuplicates: true })
      );

      const summary = {
        fileName: file.name,
        totalRows: rawRows.length,
        validRows: skuMap.size,
        rowErrors: errors.length,
        skus: {
          unique: skuMap.size,
          inserted: skusAdded,
          existing: skuMap.size - skusAdded,
        },
        skuGroups: {
          unique: groupSet.size,
          inserted: groupsAdded,
          existing: groupSet.size - groupsAdded,
        },
        mappings: {
          unique: mappingPairs.size,
          inserted: mappingsAdded,
          existing: mappingPairs.size - mappingsAdded - orphanPairs.length,
          orphan: orphanPairs.length,
        },
        errors: errors.slice(0, 50), // cap response size
        orphanPairs: orphanPairs.slice(0, 50),
      };

      // Audit log
      await logAuditEvent(context, {
        action: AuditAction.IMPORT,
        targetTable: 'skus',
        afterData: summary as unknown as Record<string, unknown>,
      });

      return success(summary);
    } catch (error) {
      console.error('SKU import failed:', error);
      return serverError('SKU import failed');
    }
  }
);
