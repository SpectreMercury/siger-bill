/**
 * Route configuration with permission requirements
 * Used by Sidebar and route guards
 */

export interface RouteConfig {
  path: string;
  name: string;
  icon?: string;
  permission?: {
    resource: string;
    action: string;
  };
  roles?: string[];
  adminOnly?: boolean;
  financeOnly?: boolean;
  children?: RouteConfig[];
}

export const mainRoutes: RouteConfig[] = [
  {
    path: '/',
    name: 'Dashboard',
    icon: 'dashboard',
  },
  {
    path: '/invoices',
    name: 'Invoices',
    icon: 'invoice',
    permission: { resource: 'invoices', action: 'read' },
  },
];

export const adminRoutes: RouteConfig[] = [
  {
    path: '/admin/customers',
    name: 'Customers',
    icon: 'users',
    permission: { resource: 'customers', action: 'read' },
    adminOnly: true,
  },
  {
    path: '/admin/billing-accounts',
    name: 'Billing Accounts',
    icon: 'credit-card',
    permission: { resource: 'billing_accounts', action: 'read' },
    adminOnly: true,
  },
  {
    path: '/admin/projects',
    name: 'Projects',
    icon: 'folder',
    permission: { resource: 'projects', action: 'read' },
    adminOnly: true,
  },
  {
    path: '/admin/sku-groups',
    name: 'Product Groups',
    icon: 'box',
    permission: { resource: 'sku_groups', action: 'read' },
    adminOnly: true,
  },
  {
    path: '/admin/pricing-lists',
    name: 'Pricing Lists',
    icon: 'tag',
    permission: { resource: 'pricing', action: 'read' },
    adminOnly: true,
  },
  {
    path: '/admin/credits',
    name: 'Credits',
    icon: 'gift',
    permission: { resource: 'credits', action: 'read' },
    adminOnly: true,
  },
  {
    path: '/admin/special-rules',
    name: 'Special Rules',
    icon: 'settings',
    permission: { resource: 'special_rules', action: 'read' },
    adminOnly: true,
  },
  {
    path: '/admin/invoice-runs',
    name: 'Invoice Runs',
    icon: 'play',
    permission: { resource: 'invoice_runs', action: 'read' },
    adminOnly: true,
  },
];

export const allRoutes = [...mainRoutes, ...adminRoutes];

/**
 * Check if a user can access a route based on their permissions
 */
export function canAccessRoute(
  route: RouteConfig,
  options: {
    isSuperAdmin: boolean;
    isAdmin: boolean;
    isFinance: boolean;
    hasPermission: (resource: string, action: string) => boolean;
  }
): boolean {
  const { isSuperAdmin, isAdmin, isFinance, hasPermission } = options;

  // Super admin can access everything
  if (isSuperAdmin) return true;

  // Admin-only routes require admin role
  if (route.adminOnly && !isAdmin) return false;

  // Finance-only routes require finance role
  if (route.financeOnly && !isFinance) return false;

  // Check specific permission
  if (route.permission) {
    return hasPermission(route.permission.resource, route.permission.action);
  }

  // No specific permission required
  return true;
}

/**
 * Filter routes to only those accessible by the user
 */
export function filterAccessibleRoutes(
  routes: RouteConfig[],
  options: {
    isSuperAdmin: boolean;
    isAdmin: boolean;
    isFinance: boolean;
    hasPermission: (resource: string, action: string) => boolean;
  }
): RouteConfig[] {
  return routes.filter((route) => canAccessRoute(route, options));
}
