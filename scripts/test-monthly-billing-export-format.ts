import assert from 'node:assert/strict';
import { PricingBasis, Prisma } from '@prisma/client';
import {
  buildMonthlyBillingExportFilename,
  buildMonthlyBillingExportContentDisposition,
  filenameFromContentDisposition,
} from '../src/lib/billing/monthly-export';
import { formatDiscountPriceLabel } from '../src/lib/invoice-presentation/exporters/xlsx';

assert.equal(
  buildMonthlyBillingExportFilename('2026-07', 'SE'),
  'billing-202607-SE.xlsx'
);
assert.equal(
  buildMonthlyBillingExportFilename('2026-07', 'SE/APAC'),
  'billing-202607-SE-APAC.xlsx'
);
assert.equal(
  buildMonthlyBillingExportFilename('2026-07'),
  'billing-202607-all.xlsx'
);
assert.match(
  buildMonthlyBillingExportContentDisposition('billing-202607-西格.xlsx'),
  /filename\*=UTF-8''billing-202607-%E8%A5%BF%E6%A0%BC\.xlsx/
);
assert.equal(
  filenameFromContentDisposition(
    buildMonthlyBillingExportContentDisposition('billing-202607-西格.xlsx')
  ),
  'billing-202607-西格.xlsx'
);

const fullPriceMultiplier = new Prisma.Decimal(1);
assert.equal(
  formatDiscountPriceLabel(null, PricingBasis.STANDARD, fullPriceMultiplier),
  'List Price * 100%'
);
assert.equal(
  formatDiscountPriceLabel(null, PricingBasis.COST, fullPriceMultiplier),
  'Cost * 100%'
);

console.log('monthly billing export format tests passed');
