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
  BarChart3,
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
  Cloud,
  FileCheck2,
  Sparkles,
  ClipboardList,
  Banknote,
  Link2,
  Target,
  ChevronDown,
} from 'lucide-react';
import { useState } from 'react';

interface NavItem {
  nameKey: string;
  href: string;
  icon: React.ReactNode;
  permission?: { resource: string; action: string };
  roles?: string[];
  adminOnly?: boolean;
  planned?: boolean;
}

interface NavSection {
  titleKey: string;
  items: NavItem[];
  subsections?: {
    titleKey: string;
    icon: React.ReactNode;
    items: NavItem[];
  }[];
  adminOnly?: boolean;
}

// ─── Section 1: Main Functions ───
const mainSection: NavSection = {
  titleKey: 'main.title',
  items: [
    {
      nameKey: 'main.dashboard',
      href: '/dashboard',
      icon: <LayoutDashboard className="h-4 w-4" />,
    },
    {
      nameKey: 'main.reports',
      href: '#',
      icon: <BarChart3 className="h-4 w-4" />,
      planned: true,
    },
    {
      nameKey: 'main.users',
      href: '/admin/users',
      icon: <Users className="h-4 w-4" />,
      permission: { resource: 'users', action: 'list' },
      roles: ['super_admin'],
    },
    {
      nameKey: 'main.auditLogs',
      href: '/admin/audit-logs',
      icon: <ScrollText className="h-4 w-4" />,
      permission: { resource: 'audit_logs', action: 'read' },
      adminOnly: true,
    },
    {
      nameKey: 'main.settings',
      href: '/settings',
      icon: <Cog className="h-4 w-4" />,
    },
  ],
};

// ─── Section 2: Financial Management ───
const financeSection: NavSection = {
  titleKey: 'finance.title',
  adminOnly: true,
  items: [
    {
      nameKey: 'finance.invoices',
      href: '/invoices',
      icon: <FileText className="h-4 w-4" />,
      permission: { resource: 'invoices', action: 'read' },
    },
    {
      nameKey: 'finance.invoiceRuns',
      href: '/admin/invoice-runs',
      icon: <RefreshCw className="h-4 w-4" />,
      permission: { resource: 'invoice_runs', action: 'read' },
      adminOnly: true,
    },
    {
      nameKey: 'finance.balance',
      href: '#',
      icon: <Wallet className="h-4 w-4" />,
      planned: true,
      adminOnly: true,
    },
    {
      nameKey: 'finance.payments',
      href: '/admin/payments',
      icon: <DollarSign className="h-4 w-4" />,
      permission: { resource: 'payments', action: 'list' },
      adminOnly: true,
    },
    {
      nameKey: 'finance.reconciliation',
      href: '/admin/reconciliation',
      icon: <Scale className="h-4 w-4" />,
      permission: { resource: 'reconciliation', action: 'read' },
      adminOnly: true,
    },
  ],
};

// ─── Section 3: Customer Management ───
const customerSection: NavSection = {
  titleKey: 'customer.title',
  adminOnly: true,
  items: [
    {
      nameKey: 'customer.customers',
      href: '/admin/customers',
      icon: <Building2 className="h-4 w-4" />,
      permission: { resource: 'customers', action: 'read' },
      adminOnly: true,
    },
    {
      nameKey: 'customer.contracts',
      href: '#',
      icon: <FileCheck2 className="h-4 w-4" />,
      planned: true,
      adminOnly: true,
    },
    {
      nameKey: 'customer.pricingLists',
      href: '/admin/pricing-lists',
      icon: <CircleDollarSign className="h-4 w-4" />,
      permission: { resource: 'pricing_lists', action: 'read' },
      adminOnly: true,
    },
    {
      nameKey: 'customer.credits',
      href: '/admin/credits',
      icon: <CreditCard className="h-4 w-4" />,
      permission: { resource: 'credits', action: 'read' },
      adminOnly: true,
    },
    {
      nameKey: 'customer.specialRules',
      href: '/admin/special-rules',
      icon: <Sparkles className="h-4 w-4" />,
      permission: { resource: 'special_rules', action: 'read' },
      adminOnly: true,
    },
    {
      nameKey: 'customer.rawCostImports',
      href: '/admin/raw-cost-imports',
      icon: <Database className="h-4 w-4" />,
      permission: { resource: 'raw_costs', action: 'list' },
      adminOnly: true,
    },
  ],
};

// ─── Section 4: Operations ───
const operationsSection: NavSection = {
  titleKey: 'operations.title',
  adminOnly: true,
  subsections: [
    {
      titleKey: 'operations.gcp',
      icon: <Cloud className="h-4 w-4" />,
      items: [
        {
          nameKey: 'operations.gcpSourceData',
          href: '/admin/gcp-connections',
          icon: <Database className="h-4 w-4" />,
          roles: ['super_admin'],
        },
        {
          nameKey: 'operations.gcpBillingAccounts',
          href: '/admin/billing-accounts',
          icon: <CreditCard className="h-4 w-4" />,
          permission: { resource: 'billing_accounts', action: 'read' },
          adminOnly: true,
        },
        {
          nameKey: 'operations.gcpProjects',
          href: '/admin/projects',
          icon: <FolderKanban className="h-4 w-4" />,
          permission: { resource: 'projects', action: 'read' },
          adminOnly: true,
        },
        {
          nameKey: 'operations.gcpSkuGroups',
          href: '/admin/sku-groups',
          icon: <Tags className="h-4 w-4" />,
          permission: { resource: 'sku_groups', action: 'read' },
          adminOnly: true,
        },
        {
          nameKey: 'operations.gcpRegistrations',
          href: '#',
          icon: <ClipboardList className="h-4 w-4" />,
          planned: true,
          adminOnly: true,
        },
        {
          nameKey: 'operations.gcpContracts',
          href: '#',
          icon: <FileCheck2 className="h-4 w-4" />,
          planned: true,
          adminOnly: true,
        },
        {
          nameKey: 'operations.gcpCredits',
          href: '#',
          icon: <CreditCard className="h-4 w-4" />,
          planned: true,
          adminOnly: true,
        },
        {
          nameKey: 'operations.gcpFundings',
          href: '#',
          icon: <Banknote className="h-4 w-4" />,
          planned: true,
          adminOnly: true,
        },
      ],
    },
    {
      titleKey: 'operations.aws',
      icon: <Cloud className="h-4 w-4" />,
      items: [
        {
          nameKey: 'operations.awsSourceData',
          href: '#',
          icon: <Database className="h-4 w-4" />,
          planned: true,
          adminOnly: true,
        },
        {
          nameKey: 'operations.awsPayerAccounts',
          href: '#',
          icon: <Building2 className="h-4 w-4" />,
          planned: true,
          adminOnly: true,
        },
        {
          nameKey: 'operations.awsLinkedAccounts',
          href: '#',
          icon: <Link2 className="h-4 w-4" />,
          planned: true,
          adminOnly: true,
        },
        {
          nameKey: 'operations.awsOpportunities',
          href: '#',
          icon: <Target className="h-4 w-4" />,
          planned: true,
          adminOnly: true,
        },
        {
          nameKey: 'operations.awsContracts',
          href: '#',
          icon: <FileCheck2 className="h-4 w-4" />,
          planned: true,
          adminOnly: true,
        },
        {
          nameKey: 'operations.awsCredits',
          href: '#',
          icon: <CreditCard className="h-4 w-4" />,
          planned: true,
          adminOnly: true,
        },
        {
          nameKey: 'operations.awsFundings',
          href: '#',
          icon: <Banknote className="h-4 w-4" />,
          planned: true,
          adminOnly: true,
        },
      ],
    },
  ],
  items: [],
};

const allSections = [mainSection, financeSection, customerSection, operationsSection];

function CollapsibleSubsection({
  titleKey,
  icon,
  items,
  t,
  isActive,
  renderItem,
}: {
  titleKey: string;
  icon: React.ReactNode;
  items: NavItem[];
  t: ReturnType<typeof useTranslations>;
  isActive: (href: string) => boolean;
  renderItem: (item: NavItem) => React.ReactNode | null;
}) {
  const hasActiveChild = items.some((item) => isActive(item.href));
  const [open, setOpen] = useState(hasActiveChild);

  const renderedItems = items.map(renderItem).filter(Boolean);
  if (renderedItems.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 w-full text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-sidebar-foreground transition-colors"
      >
        {icon}
        <span className="flex-1 text-left">{t(`nav.${titleKey}`)}</span>
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <ul className="space-y-0.5 mt-0.5 ml-2">{renderedItems}</ul>}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { hasPermission, isAdmin, isSuperAdmin, user } = useAuth();
  const t = useTranslations();

  const canShowItem = (item: NavItem): boolean => {
    if (item.adminOnly && !isAdmin && !isSuperAdmin) return false;
    if (item.permission) {
      return hasPermission(item.permission.resource, item.permission.action);
    }
    if (item.roles) {
      return item.roles.some((role) => (user?.roles ?? []).includes(role)) || isSuperAdmin;
    }
    return true;
  };

  const isActivePath = (href: string): boolean => {
    if (href === '#') return false;
    if (href === '/dashboard') return pathname === '/' || pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  const renderNavItem = (item: NavItem) => {
    if (!canShowItem(item)) return null;
    const active = isActivePath(item.href);
    const isPlanned = item.planned || item.href === '#';

    return (
      <li key={item.nameKey}>
        {isPlanned ? (
          <span
            className="flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm text-muted-foreground/50 cursor-not-allowed"
          >
            {item.icon}
            <span className="flex-1">{t(`nav.${item.nameKey}`)}</span>
            <span className="text-[10px] border rounded px-1 py-0.5 border-muted-foreground/20">
              Soon
            </span>
          </span>
        ) : (
          <Link
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              active
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
          >
            {item.icon}
            {t(`nav.${item.nameKey}`)}
          </Link>
        )}
      </li>
    );
  };

  const initials = user?.firstName && user?.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`
    : user?.email?.[0]?.toUpperCase() || 'U';

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border h-full flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-6 h-[65px] flex flex-col justify-center border-b border-sidebar-border">
        <h1 className="text-xl font-bold text-sidebar-foreground">{t('common.appName')}</h1>
        <p className="text-xs text-muted-foreground">{t('common.appSubtitle')}</p>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1">
        <nav className="px-3 py-4 space-y-5">
          {allSections.map((section) => {
            if (section.adminOnly && !isAdmin && !isSuperAdmin) return null;

            const filteredItems = section.items.filter(canShowItem);
            const hasSubsections = section.subsections && section.subsections.length > 0;

            if (filteredItems.length === 0 && !hasSubsections) return null;

            return (
              <div key={section.titleKey}>
                <h3 className="px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {t(`nav.${section.titleKey}`)}
                </h3>

                {filteredItems.length > 0 && (
                  <ul className="space-y-0.5">
                    {filteredItems.map(renderNavItem)}
                  </ul>
                )}

                {section.subsections?.map((sub) => (
                  <CollapsibleSubsection
                    key={sub.titleKey}
                    titleKey={sub.titleKey}
                    icon={sub.icon}
                    items={sub.items}
                    t={t}
                    isActive={isActivePath}
                    renderItem={renderNavItem}
                  />
                ))}
              </div>
            );
          })}
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
