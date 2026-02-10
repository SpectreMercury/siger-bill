/**
 * Database Seed Script
 *
 * Creates the initial data required for the Sieger GCP Reseller Management Console:
 * - System roles (super_admin, admin, finance, viewer)
 * - Permissions for all resources
 * - Role-permission mappings
 * - Default customer
 * - Super admin user
 *
 * Run: npm run db:seed
 */

import { PrismaClient, ScopeType } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create Prisma client with Neon adapter
const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

// ============================================================================
// CONFIGURATION
// ============================================================================

const SALT_ROUNDS = 12;

// Default super admin credentials
const SUPER_ADMIN = {
  email: 'admin@sieger.com',
  password: 'SiegerAdmin2024!', // Change in production
  firstName: 'System',
  lastName: 'Administrator',
};

// Default test customer
const DEFAULT_CUSTOMER = {
  name: 'Acme Corporation',
  externalId: 'GCP-CUST-001',
  billingAccountId: 'BILLING-001',
  domain: 'acme.com',
  currency: 'USD',
  paymentTermsDays: 30,
  primaryContactName: 'John Doe',
  primaryContactEmail: 'john.doe@acme.com',
};

// ============================================================================
// ROLES DEFINITION
// ============================================================================

interface RoleDefinition {
  name: string;
  description: string;
  isSystem: boolean;
}

const ROLES: RoleDefinition[] = [
  {
    name: 'super_admin',
    description: 'Full system access. Bypasses all scope restrictions.',
    isSystem: true,
  },
  {
    name: 'admin',
    description: 'Administrative access with scope restrictions.',
    isSystem: true,
  },
  {
    name: 'finance',
    description: 'Finance team access. Can manage invoices and billing.',
    isSystem: true,
  },
  {
    name: 'viewer',
    description: 'Read-only access within assigned scopes.',
    isSystem: true,
  },
];

// ============================================================================
// PERMISSIONS DEFINITION
// ============================================================================

interface PermissionDefinition {
  resource: string;
  action: string;
  description: string;
}

// All resources and their available actions
const RESOURCES = [
  'users', 'roles', 'customers', 'invoices', 'invoice_runs', 'audit_logs',
  'billing_accounts', 'projects', 'customer_projects', 'raw_cost'
] as const;
const ACTIONS = ['create', 'read', 'update', 'delete', 'list'] as const;

function generatePermissions(): PermissionDefinition[] {
  const permissions: PermissionDefinition[] = [];

  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      permissions.push({
        resource,
        action,
        description: `Can ${action} ${resource}`,
      });
    }
  }

  // Add special permissions
  permissions.push(
    { resource: 'invoices', action: 'lock', description: 'Can lock invoices for audit' },
    { resource: 'invoices', action: 'export', description: 'Can export invoice data' },
    { resource: 'invoice_runs', action: 'execute', description: 'Can execute invoice batch runs' },
    { resource: 'invoice_runs', action: 'lock', description: 'Can lock invoice runs' },
    { resource: 'audit_logs', action: 'export', description: 'Can export audit logs' },
    { resource: 'raw_cost', action: 'import', description: 'Can import raw cost data' },
    { resource: 'customer_projects', action: 'bind', description: 'Can bind projects to customers' },
    { resource: 'customer_projects', action: 'unbind', description: 'Can unbind projects from customers' },
  );

  return permissions;
}

// ============================================================================
// ROLE-PERMISSION MAPPINGS
// ============================================================================

/**
 * Defines which permissions each role has.
 * super_admin gets ALL permissions automatically.
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  // Admin can manage most things except system config
  admin: [
    'users:read', 'users:list',
    'roles:read', 'roles:list',
    'customers:create', 'customers:read', 'customers:update', 'customers:list',
    'invoices:create', 'invoices:read', 'invoices:update', 'invoices:list', 'invoices:export',
    'invoice_runs:create', 'invoice_runs:read', 'invoice_runs:list', 'invoice_runs:execute',
    'audit_logs:read', 'audit_logs:list',
    // Phase 2 permissions
    'billing_accounts:create', 'billing_accounts:read', 'billing_accounts:update', 'billing_accounts:list',
    'projects:create', 'projects:read', 'projects:update', 'projects:list',
    'customer_projects:create', 'customer_projects:read', 'customer_projects:list', 'customer_projects:bind', 'customer_projects:unbind',
    'raw_cost:read', 'raw_cost:list', 'raw_cost:import',
  ],

  // Finance focuses on billing operations
  finance: [
    'customers:read', 'customers:list',
    'invoices:create', 'invoices:read', 'invoices:update', 'invoices:list', 'invoices:lock', 'invoices:export',
    'invoice_runs:create', 'invoice_runs:read', 'invoice_runs:list', 'invoice_runs:execute', 'invoice_runs:lock',
    'audit_logs:read', 'audit_logs:list',
    // Phase 2 permissions
    'billing_accounts:read', 'billing_accounts:list',
    'projects:read', 'projects:list',
    'customer_projects:read', 'customer_projects:list', 'customer_projects:bind', 'customer_projects:unbind',
    'raw_cost:read', 'raw_cost:list', 'raw_cost:import',
  ],

  // Viewer is read-only
  viewer: [
    'customers:read', 'customers:list',
    'invoices:read', 'invoices:list',
    'invoice_runs:read', 'invoice_runs:list',
    'audit_logs:read', 'audit_logs:list',
    // Phase 2 permissions
    'billing_accounts:read', 'billing_accounts:list',
    'projects:read', 'projects:list',
    'customer_projects:read', 'customer_projects:list',
    'raw_cost:read', 'raw_cost:list',
  ],
};

// ============================================================================
// SEED FUNCTIONS
// ============================================================================

async function seedRoles() {
  console.log('Seeding roles...');

  const createdRoles: Record<string, string> = {};

  for (const role of ROLES) {
    const created = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
    createdRoles[role.name] = created.id;
    console.log(`  ✓ Role: ${role.name}`);
  }

  return createdRoles;
}

async function seedPermissions() {
  console.log('Seeding permissions...');

  const permissions = generatePermissions();
  const createdPermissions: Record<string, string> = {};

  for (const perm of permissions) {
    const created = await prisma.permission.upsert({
      where: {
        resource_action: {
          resource: perm.resource,
          action: perm.action,
        },
      },
      update: { description: perm.description },
      create: perm,
    });
    createdPermissions[`${perm.resource}:${perm.action}`] = created.id;
  }

  console.log(`  ✓ Created ${permissions.length} permissions`);
  return createdPermissions;
}

async function seedRolePermissions(
  roles: Record<string, string>,
  permissions: Record<string, string>
) {
  console.log('Seeding role-permission mappings...');

  // Super admin gets all permissions
  const allPermissionIds = Object.values(permissions);
  const superAdminRoleId = roles['super_admin'];

  for (const permissionId of allPermissionIds) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: superAdminRoleId,
          permissionId,
        },
      },
      update: {},
      create: {
        roleId: superAdminRoleId,
        permissionId,
      },
    });
  }
  console.log(`  ✓ super_admin: ${allPermissionIds.length} permissions`);

  // Other roles get specific permissions
  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roles[roleName];
    if (!roleId) continue;

    for (const permKey of permissionKeys) {
      const permissionId = permissions[permKey];
      if (!permissionId) {
        console.warn(`    ⚠ Permission not found: ${permKey}`);
        continue;
      }

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId,
            permissionId,
          },
        },
        update: {},
        create: {
          roleId,
          permissionId,
        },
      });
    }
    console.log(`  ✓ ${roleName}: ${permissionKeys.length} permissions`);
  }
}

async function seedCustomer() {
  console.log('Seeding default customer...');

  const customer = await prisma.customer.upsert({
    where: { externalId: DEFAULT_CUSTOMER.externalId },
    update: {},
    create: DEFAULT_CUSTOMER,
  });

  console.log(`  ✓ Customer: ${customer.name} (${customer.id})`);
  return customer.id;
}

async function seedSuperAdmin(superAdminRoleId: string, customerId: string) {
  console.log('Seeding super admin user...');

  const passwordHash = await bcrypt.hash(SUPER_ADMIN.password, SALT_ROUNDS);

  const user = await prisma.user.upsert({
    where: { email: SUPER_ADMIN.email },
    update: {
      passwordHash,
      firstName: SUPER_ADMIN.firstName,
      lastName: SUPER_ADMIN.lastName,
    },
    create: {
      email: SUPER_ADMIN.email,
      passwordHash,
      firstName: SUPER_ADMIN.firstName,
      lastName: SUPER_ADMIN.lastName,
      isActive: true,
    },
  });

  // Assign super_admin role
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: superAdminRoleId,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: superAdminRoleId,
    },
  });

  // Grant access to default customer (super_admin bypasses, but good for completeness)
  await prisma.userScope.upsert({
    where: {
      userId_scopeType_scopeId: {
        userId: user.id,
        scopeType: ScopeType.CUSTOMER,
        scopeId: customerId,
      },
    },
    update: {},
    create: {
      userId: user.id,
      scopeType: ScopeType.CUSTOMER,
      scopeId: customerId,
    },
  });

  console.log(`  ✓ Super Admin: ${user.email} (${user.id})`);
  console.log(`    Password: ${SUPER_ADMIN.password}`);

  return user.id;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('========================================');
  console.log('Sieger GCP Reseller Console - DB Seed');
  console.log('========================================\n');

  try {
    const roles = await seedRoles();
    const permissions = await seedPermissions();
    await seedRolePermissions(roles, permissions);
    const customerId = await seedCustomer();
    await seedSuperAdmin(roles['super_admin'], customerId);

    console.log('\n========================================');
    console.log('Seed completed successfully!');
    console.log('========================================\n');

    // Summary
    const userCount = await prisma.user.count();
    const roleCount = await prisma.role.count();
    const permissionCount = await prisma.permission.count();
    const customerCount = await prisma.customer.count();

    console.log('Summary:');
    console.log(`  Users: ${userCount}`);
    console.log(`  Roles: ${roleCount}`);
    console.log(`  Permissions: ${permissionCount}`);
    console.log(`  Customers: ${customerCount}`);

  } catch (error) {
    console.error('Seed failed:', error);
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
