'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/shadcn/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/shadcn/avatar';
import { Separator } from '@/components/ui/shadcn/separator';
import {
  LayoutDashboard,
  FileText,
  Building2,
  CreditCard,
  FolderKanban,
  Tags,
  CircleDollarSign,
  Wallet,
  Settings,
  RefreshCw,
  Users,
  Database,
  Scale,
  ScrollText,
  DollarSign,
  Cog,
} from 'lucide-react';

interface NavItem {
  nameKey: string;
  href: string;
  icon: React.ReactNode;
  permission?: { resource: string; action: string };
  roles?: string[];
  adminOnly?: boolean;
}

const mainNavItems: NavItem[] = [
  {
    nameKey: 'dashboard',
    href: '/dashboard',
    icon: <LayoutDashboard className="h-5 w-5" />,
  },
  {
    nameKey: 'invoices',
    href: '/invoices',
    icon: <FileText className="h-5 w-5" />,
    permission: { resource: 'invoices', action: 'read' },
  },
  {
    nameKey: 'settings',
    href: '/settings',
    icon: <Cog className="h-5 w-5" />,
  },
];

const adminNavItems: NavItem[] = [
  {
    nameKey: 'customers',
    href: '/admin/customers',
    icon: <Building2 className="h-5 w-5" />,
    permission: { resource: 'customers', action: 'read' },
    adminOnly: true,
  },
  {
    nameKey: 'billingAccounts',
    href: '/admin/billing-accounts',
    icon: <CreditCard className="h-5 w-5" />,
    permission: { resource: 'billing_accounts', action: 'read' },
    adminOnly: true,
  },
  {
    nameKey: 'projects',
    href: '/admin/projects',
    icon: <FolderKanban className="h-5 w-5" />,
    permission: { resource: 'projects', action: 'read' },
    adminOnly: true,
  },
  {
    nameKey: 'productGroups',
    href: '/admin/sku-groups',
    icon: <Tags className="h-5 w-5" />,
    permission: { resource: 'sku_groups', action: 'read' },
    adminOnly: true,
  },
  {
    nameKey: 'pricingLists',
    href: '/admin/pricing-lists',
    icon: <CircleDollarSign className="h-5 w-5" />,
    permission: { resource: 'pricing_lists', action: 'read' },
    adminOnly: true,
  },
  {
    nameKey: 'credits',
    href: '/admin/credits',
    icon: <Wallet className="h-5 w-5" />,
    permission: { resource: 'credits', action: 'read' },
    adminOnly: true,
  },
  {
    nameKey: 'specialRules',
    href: '/admin/special-rules',
    icon: <Settings className="h-5 w-5" />,
    permission: { resource: 'special_rules', action: 'read' },
    adminOnly: true,
  },
  {
    nameKey: 'invoiceRuns',
    href: '/admin/invoice-runs',
    icon: <RefreshCw className="h-5 w-5" />,
    permission: { resource: 'invoice_runs', action: 'read' },
    adminOnly: true,
  },
  {
    nameKey: 'payments',
    href: '/admin/payments',
    icon: <DollarSign className="h-5 w-5" />,
    permission: { resource: 'payments', action: 'list' },
    adminOnly: true,
  },
  {
    nameKey: 'rawCostImports',
    href: '/admin/raw-cost-imports',
    icon: <Database className="h-5 w-5" />,
    permission: { resource: 'raw_costs', action: 'list' },
    adminOnly: true,
  },
  {
    nameKey: 'reconciliation',
    href: '/admin/reconciliation',
    icon: <Scale className="h-5 w-5" />,
    permission: { resource: 'reconciliation', action: 'read' },
    adminOnly: true,
  },
  {
    nameKey: 'users',
    href: '/admin/users',
    icon: <Users className="h-5 w-5" />,
    permission: { resource: 'users', action: 'list' },
    adminOnly: true,
  },
  {
    nameKey: 'auditLogs',
    href: '/admin/audit-logs',
    icon: <ScrollText className="h-5 w-5" />,
    permission: { resource: 'audit_logs', action: 'read' },
    adminOnly: true,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { hasPermission, isAdmin, isSuperAdmin, user } = useAuth();
  const t = useTranslations();

  const canShowItem = (item: NavItem): boolean => {
    if (item.adminOnly && !isAdmin && !isSuperAdmin) {
      return false;
    }
    if (item.permission) {
      return hasPermission(item.permission.resource, item.permission.action);
    }
    if (item.roles) {
      return item.roles.some((role) => (user?.roles ?? []).includes(role)) || isSuperAdmin;
    }
    return true;
  };

  const isActive = (href: string): boolean => {
    if (href === '/dashboard') return pathname === '/' || pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  const filteredMainNav = mainNavItems.filter(canShowItem);
  const filteredAdminNav = adminNavItems.filter(canShowItem);

  const initials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user?.email?.[0]?.toUpperCase() || 'U';

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border h-full flex flex-col shrink-0">
      {/* Logo - height matches header (h-[65px] = py-4 + content) */}
      <div className="px-6 h-[65px] flex flex-col justify-center border-b border-sidebar-border">
        <h1 className="text-xl font-bold text-sidebar-foreground">{t('common.appName')}</h1>
        <p className="text-xs text-muted-foreground">{t('common.appSubtitle')}</p>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1">
        <nav className="px-4 py-6 space-y-8">
          {/* Main Nav */}
          <div>
            <ul className="space-y-1">
              {filteredMainNav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      isActive(item.href)
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    )}
                  >
                    {item.icon}
                    {t(`nav.main.${item.nameKey}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Admin Nav */}
          {filteredAdminNav.length > 0 && (
            <div>
              <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {t('nav.admin.title')}
              </h3>
              <ul className="space-y-1">
                {filteredAdminNav.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                        isActive(item.href)
                          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                      )}
                    >
                      {item.icon}
                      {t(`nav.admin.${item.nameKey}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>
      </ScrollArea>

      {/* User Info */}
      <Separator className="bg-sidebar-border" />
      <div className="px-4 py-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
