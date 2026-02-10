'use client';

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Users,
  Building2,
  FolderKanban,
  Layers,
  Tag,
  CreditCard,
  FileText,
  Receipt,
  Upload,
  ClipboardCheck,
  ScrollText,
  Settings,
  ArrowRight,
  Shield,
  HelpCircle,
  GitBranch,
} from 'lucide-react';
import Link from 'next/link';
import { ConfigFlowDiagram } from '@/components/help/ConfigFlowDiagram';

interface ModuleGuide {
  icon: React.ReactNode;
  titleKey: string;
  descriptionKey: string;
  href: string;
  steps: string[];
}

export default function HelpPage() {
  const t = useTranslations('help');
  const tn = useTranslations('nav');

  const modules: ModuleGuide[] = [
    {
      icon: <Users className="h-5 w-5" />,
      titleKey: 'modules.customers.title',
      descriptionKey: 'modules.customers.description',
      href: '/admin/customers',
      steps: [
        'modules.customers.step1',
        'modules.customers.step2',
        'modules.customers.step3',
      ],
    },
    {
      icon: <Building2 className="h-5 w-5" />,
      titleKey: 'modules.billingAccounts.title',
      descriptionKey: 'modules.billingAccounts.description',
      href: '/admin/billing-accounts',
      steps: [
        'modules.billingAccounts.step1',
        'modules.billingAccounts.step2',
      ],
    },
    {
      icon: <FolderKanban className="h-5 w-5" />,
      titleKey: 'modules.projects.title',
      descriptionKey: 'modules.projects.description',
      href: '/admin/projects',
      steps: [
        'modules.projects.step1',
        'modules.projects.step2',
        'modules.projects.step3',
      ],
    },
    {
      icon: <Layers className="h-5 w-5" />,
      titleKey: 'modules.productGroups.title',
      descriptionKey: 'modules.productGroups.description',
      href: '/admin/sku-groups',
      steps: [
        'modules.productGroups.step1',
        'modules.productGroups.step2',
        'modules.productGroups.step3',
      ],
    },
    {
      icon: <Tag className="h-5 w-5" />,
      titleKey: 'modules.pricingLists.title',
      descriptionKey: 'modules.pricingLists.description',
      href: '/admin/pricing-lists',
      steps: [
        'modules.pricingLists.step1',
        'modules.pricingLists.step2',
        'modules.pricingLists.step3',
      ],
    },
    {
      icon: <CreditCard className="h-5 w-5" />,
      titleKey: 'modules.credits.title',
      descriptionKey: 'modules.credits.description',
      href: '/admin/credits',
      steps: [
        'modules.credits.step1',
        'modules.credits.step2',
      ],
    },
    {
      icon: <Upload className="h-5 w-5" />,
      titleKey: 'modules.costImports.title',
      descriptionKey: 'modules.costImports.description',
      href: '/admin/raw-cost-imports',
      steps: [
        'modules.costImports.step1',
        'modules.costImports.step2',
      ],
    },
    {
      icon: <FileText className="h-5 w-5" />,
      titleKey: 'modules.invoiceRuns.title',
      descriptionKey: 'modules.invoiceRuns.description',
      href: '/admin/invoice-runs',
      steps: [
        'modules.invoiceRuns.step1',
        'modules.invoiceRuns.step2',
        'modules.invoiceRuns.step3',
      ],
    },
    {
      icon: <Receipt className="h-5 w-5" />,
      titleKey: 'modules.payments.title',
      descriptionKey: 'modules.payments.description',
      href: '/admin/payments',
      steps: [
        'modules.payments.step1',
        'modules.payments.step2',
      ],
    },
    {
      icon: <ClipboardCheck className="h-5 w-5" />,
      titleKey: 'modules.reconciliation.title',
      descriptionKey: 'modules.reconciliation.description',
      href: '/admin/reconciliation',
      steps: [
        'modules.reconciliation.step1',
        'modules.reconciliation.step2',
      ],
    },
    {
      icon: <Shield className="h-5 w-5" />,
      titleKey: 'modules.users.title',
      descriptionKey: 'modules.users.description',
      href: '/admin/users',
      steps: [
        'modules.users.step1',
        'modules.users.step2',
        'modules.users.step3',
      ],
    },
    {
      icon: <ScrollText className="h-5 w-5" />,
      titleKey: 'modules.auditLogs.title',
      descriptionKey: 'modules.auditLogs.description',
      href: '/admin/audit-logs',
      steps: [
        'modules.auditLogs.step1',
        'modules.auditLogs.step2',
      ],
    },
  ];

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <HelpCircle className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">{t('title')}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {t('subtitle')}
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Flow Diagram */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          {t('flowDiagram.title')}
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          {t('flowDiagram.subtitle')}
        </p>
        <ConfigFlowDiagram />
      </Card>

      {/* Quick Start */}
      <Card className="p-6 bg-primary/5 border-primary/20">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Settings className="h-5 w-5" />
          {t('quickStart.title')}
        </h2>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('quickStart.description')}</p>
          <ol className="list-decimal list-inside space-y-1 text-sm ml-2">
            <li>{t('quickStart.step1')}</li>
            <li>{t('quickStart.step2')}</li>
            <li>{t('quickStart.step3')}</li>
            <li>{t('quickStart.step4')}</li>
            <li>{t('quickStart.step5')}</li>
            <li>{t('quickStart.step6')}</li>
          </ol>
        </div>
      </Card>

      {/* Module Guides */}
      <div>
        <h2 className="text-lg font-semibold mb-4">{t('modulesTitle')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modules.map((module, index) => (
            <Card key={index} className="p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  {module.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium">{t(module.titleKey)}</h3>
                    <Link
                      href={module.href}
                      className="text-primary hover:underline text-sm flex items-center gap-1 shrink-0"
                    >
                      {t('goTo')}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t(module.descriptionKey)}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {module.steps.map((stepKey, stepIndex) => (
                      <li key={stepIndex} className="text-xs text-muted-foreground flex items-start gap-2">
                        <Badge variant="outline" className="h-4 w-4 p-0 shrink-0 flex items-center justify-center text-[10px]">
                          {stepIndex + 1}
                        </Badge>
                        <span>{t(stepKey)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Role Explanation */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5" />
          {t('roles.title')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-muted/50">
            <Badge className="mb-2">super_admin</Badge>
            <p className="text-sm text-muted-foreground">{t('roles.superAdmin')}</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <Badge variant="secondary" className="mb-2">admin</Badge>
            <p className="text-sm text-muted-foreground">{t('roles.admin')}</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <Badge variant="secondary" className="mb-2">finance</Badge>
            <p className="text-sm text-muted-foreground">{t('roles.finance')}</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <Badge variant="outline" className="mb-2">viewer</Badge>
            <p className="text-sm text-muted-foreground">{t('roles.viewer')}</p>
          </div>
        </div>
      </Card>

      {/* Tips */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">{t('tips.title')}</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-primary">•</span>
            {t('tips.tip1')}
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary">•</span>
            {t('tips.tip2')}
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary">•</span>
            {t('tips.tip3')}
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary">•</span>
            {t('tips.tip4')}
          </li>
        </ul>
      </Card>
    </div>
  );
}
