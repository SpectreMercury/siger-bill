/**
 * Mock Data Seed Script
 *
 * Creates mock data for testing the complete billing flow:
 * - Multiple customers
 * - Billing accounts & projects
 * - Raw cost entries
 * - Invoice runs with invoices
 * - Invoice line items
 *
 * Run: npx ts-node prisma/seed-mock-data.ts
 */

import { PrismaClient, InvoiceStatus, InvoiceRunStatus, CustomerStatus, BillingAccountStatus, ProjectStatus } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create Prisma client with Neon adapter
const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

// ============================================================================
// MOCK DATA CONFIGURATION
// ============================================================================

const CUSTOMERS = [
  {
    name: 'TechCorp Solutions',
    externalId: 'GCP-TECH-001',
    domain: 'techcorp.io',
    currency: 'USD',
    paymentTermsDays: 30,
    primaryContactName: 'Alice Chen',
    primaryContactEmail: 'alice@techcorp.io',
  },
  {
    name: 'DataFlow Inc',
    externalId: 'GCP-DATA-002',
    domain: 'dataflow.com',
    currency: 'USD',
    paymentTermsDays: 45,
    primaryContactName: 'Bob Williams',
    primaryContactEmail: 'bob@dataflow.com',
  },
  {
    name: 'CloudNative Labs',
    externalId: 'GCP-CLOUD-003',
    domain: 'cloudnative.dev',
    currency: 'USD',
    paymentTermsDays: 30,
    primaryContactName: 'Carol Martinez',
    primaryContactEmail: 'carol@cloudnative.dev',
  },
  {
    name: 'AI Startup Hub',
    externalId: 'GCP-AI-004',
    domain: 'aistartup.co',
    currency: 'USD',
    paymentTermsDays: 15,
    primaryContactName: 'David Kim',
    primaryContactEmail: 'david@aistartup.co',
  },
];

const BILLING_ACCOUNTS = [
  { billingAccountId: '01A2B3-C4D5E6-F78901', name: 'TechCorp Main Billing' },
  { billingAccountId: '02B3C4-D5E6F7-890123', name: 'DataFlow Production' },
  { billingAccountId: '03C4D5-E6F7G8-901234', name: 'CloudNative Dev Account' },
  { billingAccountId: '04D5E6-F7G8H9-012345', name: 'AI Startup Research' },
];

const PROJECTS = [
  { projectId: 'techcorp-prod-001', name: 'TechCorp Production', billingAccountIndex: 0 },
  { projectId: 'techcorp-dev-002', name: 'TechCorp Development', billingAccountIndex: 0 },
  { projectId: 'dataflow-analytics-001', name: 'DataFlow Analytics', billingAccountIndex: 1 },
  { projectId: 'dataflow-ml-002', name: 'DataFlow ML Pipeline', billingAccountIndex: 1 },
  { projectId: 'cloudnative-k8s-001', name: 'CloudNative Kubernetes', billingAccountIndex: 2 },
  { projectId: 'cloudnative-serverless-002', name: 'CloudNative Serverless', billingAccountIndex: 2 },
  { projectId: 'aistartup-training-001', name: 'AI Training Cluster', billingAccountIndex: 3 },
  { projectId: 'aistartup-inference-002', name: 'AI Inference API', billingAccountIndex: 3 },
];

// GCP Services and SKUs for realistic line items
const GCP_SERVICES = [
  {
    serviceId: '6F81-5844-456A',
    serviceName: 'Compute Engine',
    skus: [
      { skuId: 'D123-4567-89AB', description: 'N1 Standard Instance Core running in Americas', unitPrice: 0.0475 },
      { skuId: 'E234-5678-9ABC', description: 'N1 Standard Instance Ram running in Americas', unitPrice: 0.00475 },
      { skuId: 'F345-6789-ABCD', description: 'Storage PD Capacity', unitPrice: 0.040 },
      { skuId: 'G456-789A-BCDE', description: 'Network Egress via Carrier Peering', unitPrice: 0.085 },
    ],
  },
  {
    serviceId: '95FF-2EF5-5EA1',
    serviceName: 'Cloud Storage',
    skus: [
      { skuId: 'H567-89AB-CDEF', description: 'Standard Storage US Multi-region', unitPrice: 0.026 },
      { skuId: 'I678-9ABC-DEF0', description: 'Nearline Storage US Multi-region', unitPrice: 0.010 },
      { skuId: 'J789-ABCD-EF01', description: 'Class A Operations', unitPrice: 0.005 },
      { skuId: 'K89A-BCDE-F012', description: 'Class B Operations', unitPrice: 0.0004 },
    ],
  },
  {
    serviceId: '152E-C115-5142',
    serviceName: 'BigQuery',
    skus: [
      { skuId: 'L9AB-CDEF-0123', description: 'Analysis (On Demand)', unitPrice: 5.00 },
      { skuId: 'M0BC-DEF0-1234', description: 'Active Storage', unitPrice: 0.020 },
      { skuId: 'N1CD-EF01-2345', description: 'Streaming Inserts', unitPrice: 0.010 },
    ],
  },
  {
    serviceId: 'A1B2-C3D4-E5F6',
    serviceName: 'Cloud Run',
    skus: [
      { skuId: 'O2DE-F012-3456', description: 'CPU Allocation Time', unitPrice: 0.00002400 },
      { skuId: 'P3EF-0123-4567', description: 'Memory Allocation Time', unitPrice: 0.00000250 },
      { skuId: 'Q4F0-1234-5678', description: 'Requests', unitPrice: 0.40 },
    ],
  },
  {
    serviceId: 'B2C3-D4E5-F6G7',
    serviceName: 'Cloud SQL',
    skus: [
      { skuId: 'R5G1-2345-6789', description: 'DB Custom Instance Core', unitPrice: 0.0413 },
      { skuId: 'S6H2-3456-789A', description: 'DB Custom Instance RAM', unitPrice: 0.0070 },
      { skuId: 'T7I3-4567-89AB', description: 'Storage SSD', unitPrice: 0.170 },
    ],
  },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateInvoiceNumber(customerId: string, month: string, index: number): string {
  const year = month.slice(2, 4);
  const monthNum = month.slice(5, 7);
  return `INV-${year}${monthNum}-${String(index + 1).padStart(4, '0')}`;
}

function getRandomAmount(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function getRandomUsage(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 10000) / 10000;
}

// ============================================================================
// SEED FUNCTIONS
// ============================================================================

async function seedCustomers() {
  console.log('Seeding customers...');
  const customerIds: string[] = [];

  for (const customer of CUSTOMERS) {
    const created = await prisma.customer.upsert({
      where: { externalId: customer.externalId },
      update: {},
      create: {
        ...customer,
        status: CustomerStatus.ACTIVE,
      },
    });
    customerIds.push(created.id);
    console.log(`  ✓ Customer: ${created.name}`);
  }

  return customerIds;
}

async function seedBillingAccountsAndProjects() {
  console.log('Seeding billing accounts and projects...');
  const billingAccountIds: string[] = [];
  const projectIds: string[] = [];

  // Create billing accounts
  for (const ba of BILLING_ACCOUNTS) {
    const created = await prisma.billingAccount.upsert({
      where: { billingAccountId: ba.billingAccountId },
      update: {},
      create: {
        billingAccountId: ba.billingAccountId,
        name: ba.name,
        status: BillingAccountStatus.ACTIVE,
      },
    });
    billingAccountIds.push(created.id);
    console.log(`  ✓ Billing Account: ${ba.name}`);
  }

  // Create projects
  for (const proj of PROJECTS) {
    const created = await prisma.project.upsert({
      where: { projectId: proj.projectId },
      update: {},
      create: {
        projectId: proj.projectId,
        name: proj.name,
        status: ProjectStatus.ACTIVE,
        billingAccountId: billingAccountIds[proj.billingAccountIndex],
      },
    });
    projectIds.push(created.id);
    console.log(`  ✓ Project: ${proj.name}`);
  }

  return { billingAccountIds, projectIds };
}

async function seedCustomerProjects(customerIds: string[], projectIds: string[]) {
  console.log('Binding projects to customers...');

  // Map: customer 0 -> projects 0,1, customer 1 -> projects 2,3, etc.
  const mappings = [
    { customerIndex: 0, projectIndices: [0, 1] },
    { customerIndex: 1, projectIndices: [2, 3] },
    { customerIndex: 2, projectIndices: [4, 5] },
    { customerIndex: 3, projectIndices: [6, 7] },
  ];

  for (const mapping of mappings) {
    for (const projIdx of mapping.projectIndices) {
      await prisma.customerProject.upsert({
        where: {
          customerId_projectId_startDate: {
            customerId: customerIds[mapping.customerIndex],
            projectId: projectIds[projIdx],
            startDate: new Date('2024-01-01'),
          },
        },
        update: {},
        create: {
          customerId: customerIds[mapping.customerIndex],
          projectId: projectIds[projIdx],
          startDate: new Date('2024-01-01'),
          isActive: true,
        },
      });
    }
    console.log(`  ✓ Customer ${mapping.customerIndex + 1} bound to ${mapping.projectIndices.length} projects`);
  }
}

async function seedInvoicesAndLineItems(customerIds: string[]) {
  console.log('Seeding invoice runs, invoices, and line items...');

  // Get the admin user to use as creator
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@sieger.com' },
  });

  if (!adminUser) {
    console.error('Admin user not found. Please run db:seed first.');
    return;
  }

  // Create invoices for the last 3 months
  const months = ['2024-11', '2024-12', '2025-01'];

  for (const month of months) {
    console.log(`\n  Creating invoices for ${month}...`);

    // Create invoice run
    const invoiceRun = await prisma.invoiceRun.create({
      data: {
        billingMonth: month,
        status: InvoiceRunStatus.SUCCEEDED,
        createdBy: adminUser.id,
        startedAt: new Date(),
        finishedAt: new Date(),
        totalInvoices: customerIds.length,
        customerCount: customerIds.length,
        rowCount: customerIds.length * 15, // Approx line items
      },
    });

    console.log(`    ✓ Invoice Run: ${invoiceRun.id}`);

    // Create invoices for each customer
    let invoiceIndex = 0;
    for (const customerId of customerIds) {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });

      // Generate invoice amounts
      const baseAmount = getRandomAmount(1500, 25000);
      const creditAmount = Math.random() > 0.7 ? getRandomAmount(50, 500) : 0;
      const taxAmount = baseAmount * 0.08; // 8% tax
      const totalAmount = baseAmount - creditAmount + taxAmount;

      // Calculate dates
      const [year, monthNum] = month.split('-').map(Number);
      const issueDate = new Date(year, monthNum - 1, 28); // Last days of billing month
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + (customer?.paymentTermsDays || 30));

      // Determine status based on month
      let status: InvoiceStatus;
      let paidAt: Date | null = null;

      if (month === '2024-11') {
        status = InvoiceStatus.PAID;
        paidAt = new Date(dueDate);
        paidAt.setDate(paidAt.getDate() - Math.floor(Math.random() * 10)); // Paid before due date
      } else if (month === '2024-12') {
        status = Math.random() > 0.5 ? InvoiceStatus.PAID : InvoiceStatus.ISSUED;
        if (status === InvoiceStatus.PAID) {
          paidAt = new Date();
        }
      } else {
        status = InvoiceStatus.DRAFT;
      }

      const invoice = await prisma.invoice.create({
        data: {
          invoiceRunId: invoiceRun.id,
          customerId,
          invoiceNumber: generateInvoiceNumber(customerId, month, invoiceIndex),
          billingMonth: month,
          status,
          subtotal: baseAmount,
          creditAmount,
          taxAmount,
          totalAmount,
          currency: 'USD',
          issueDate,
          dueDate,
          paidAt,
        },
      });

      console.log(`    ✓ Invoice: ${invoice.invoiceNumber} (${status}) - $${totalAmount.toFixed(2)}`);

      // Create line items
      let lineNumber = 1;
      let remainingAmount = baseAmount;

      // Add line items from different services
      for (const service of GCP_SERVICES) {
        // Skip some services randomly
        if (Math.random() > 0.7) continue;

        for (const sku of service.skus) {
          // Skip some SKUs randomly
          if (Math.random() > 0.6) continue;

          const usage = getRandomUsage(10, 5000);
          const amount = Math.min(usage * sku.unitPrice, remainingAmount * 0.3);

          if (amount < 0.01) continue;

          await prisma.invoiceLineItem.create({
            data: {
              invoiceId: invoice.id,
              lineNumber,
              description: `${service.serviceName} - ${sku.description}`,
              quantity: usage,
              unitPrice: sku.unitPrice,
              amount,
              metadata: {
                serviceId: service.serviceId,
                serviceName: service.serviceName,
                skuId: sku.skuId,
                region: 'us-central1',
              },
            },
          });

          remainingAmount -= amount;
          lineNumber++;

          if (remainingAmount < 10) break;
        }

        if (remainingAmount < 10) break;
      }

      // Add remaining as a catch-all if needed
      if (remainingAmount > 10) {
        await prisma.invoiceLineItem.create({
          data: {
            invoiceId: invoice.id,
            lineNumber,
            description: 'Other Cloud Services',
            quantity: 1,
            unitPrice: remainingAmount,
            amount: remainingAmount,
            metadata: {
              serviceId: 'OTHER',
              serviceName: 'Other Services',
            },
          },
        });
      }

      invoiceIndex++;
    }

    // Update invoice run totals
    const invoiceTotals = await prisma.invoice.aggregate({
      where: { invoiceRunId: invoiceRun.id },
      _sum: { totalAmount: true },
      _count: true,
    });

    await prisma.invoiceRun.update({
      where: { id: invoiceRun.id },
      data: {
        totalAmount: invoiceTotals._sum.totalAmount || 0,
        totalInvoices: invoiceTotals._count,
      },
    });
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('========================================');
  console.log('Sieger - Mock Data Seed');
  console.log('========================================\n');

  try {
    const customerIds = await seedCustomers();
    const { billingAccountIds, projectIds } = await seedBillingAccountsAndProjects();
    await seedCustomerProjects(customerIds, projectIds);
    await seedInvoicesAndLineItems(customerIds);

    console.log('\n========================================');
    console.log('Mock data seed completed successfully!');
    console.log('========================================\n');

    // Summary
    const customerCount = await prisma.customer.count();
    const billingAccountCount = await prisma.billingAccount.count();
    const projectCount = await prisma.project.count();
    const invoiceRunCount = await prisma.invoiceRun.count();
    const invoiceCount = await prisma.invoice.count();
    const lineItemCount = await prisma.invoiceLineItem.count();

    console.log('Summary:');
    console.log(`  Customers: ${customerCount}`);
    console.log(`  Billing Accounts: ${billingAccountCount}`);
    console.log(`  Projects: ${projectCount}`);
    console.log(`  Invoice Runs: ${invoiceRunCount}`);
    console.log(`  Invoices: ${invoiceCount}`);
    console.log(`  Line Items: ${lineItemCount}`);

  } catch (error) {
    console.error('Mock data seed failed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
