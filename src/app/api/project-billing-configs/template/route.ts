import { NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { generateProjectBillingConfigTemplate } from '@/lib/project-billing-configs/workbook';

export const GET = withPermission(
  { resource: 'project_billing_configs', action: 'list' },
  async (): Promise<NextResponse> => {
    const content = generateProjectBillingConfigTemplate();
    return new NextResponse(new Uint8Array(content), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="project-billing-config-template.xlsx"',
        'Content-Length': content.length.toString(),
      },
    });
  }
);
