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
  Cloud,
  LayoutDashboard,
  BarChart3,
  Wallet,
  FileCheck2,
  Sparkles,
  Database,
  ClipboardList,
  Banknote,
  Link2,
  Target,
  Server,
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

interface ModuleSection {
  titleKey: string;
  icon: React.ReactNode;
  modules?: ModuleGuide[];
  subsections?: {
    titleKey: string;
    icon: React.ReactNode;
    modules: ModuleGuide[];
  }[];
}

function ModuleCard({ module, t }: { module: ModuleGuide; t: ReturnType<typeof useTranslations> }) {
  const isPlanned = module.href === '#';
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          {module.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">{t(module.titleKey)}</h3>
            {isPlanned ? (
              <Badge variant="outline" className="text-xs shrink-0">
                {t('planned')}
              </Badge>
            ) : (
              <Link
                href={module.href}
                className="text-primary hover:underline text-sm flex items-center gap-1 shrink-0"
              >
                {t('goTo')}
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
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
  );
}

export default function HelpPage() {
  const t = useTranslations('help');

  const sections: ModuleSection[] = [
    // Section 1: Main Functions
    {
      titleKey: 'sections.main',
      icon: <LayoutDashboard className="h-5 w-5" />,
      modules: [
        {
          icon: <LayoutDashboard className="h-5 w-5" />,
          titleKey: 'modules.dashboard.title',
          descriptionKey: 'modules.dashboard.description',
          href: '/dashboard',
          steps: ['modules.dashboard.step1', 'modules.dashboard.step2', 'modules.dashboard.step3'],
        },
        {
          icon: <BarChart3 className="h-5 w-5" />,
          titleKey: 'modules.reports.title',
          descriptionKey: 'modules.reports.description',
          href: '#',
          steps: ['modules.reports.step1', 'modules.reports.step2', 'modules.reports.step3'],
        },
        {
          icon: <Shield className="h-5 w-5" />,
          titleKey: 'modules.users.title',
          descriptionKey: 'modules.users.description',
          href: '/admin/users',
          steps: ['modules.users.step1', 'modules.users.step2', 'modules.users.step3', 'modules.users.step4', 'modules.users.step5'],
        },
        {
          icon: <ScrollText className="h-5 w-5" />,
          titleKey: 'modules.auditLogs.title',
          descriptionKey: 'modules.auditLogs.description',
          href: '/admin/audit-logs',
          steps: ['modules.auditLogs.step1', 'modules.auditLogs.step2', 'modules.auditLogs.step3'],
        },
      ],
    },
    // Section 2: Financial Management
    {
      titleKey: 'sections.finance',
      icon: <Receipt className="h-5 w-5" />,
      modules: [
        {
          icon: <FileText className="h-5 w-5" />,
          titleKey: 'modules.invoiceManagement.title',
          descriptionKey: 'modules.invoiceManagement.description',
          href: '/invoices',
          steps: [
            'modules.invoiceManagement.step1',
            'modules.invoiceManagement.step2',
            'modules.invoiceManagement.step3',
            'modules.invoiceManagement.step4',
            'modules.invoiceManagement.step5',
          ],
        },
        {
          icon: <Wallet className="h-5 w-5" />,
          titleKey: 'modules.balanceManagement.title',
          descriptionKey: 'modules.balanceManagement.description',
          href: '#',
          steps: [
            'modules.balanceManagement.step1',
            'modules.balanceManagement.step2',
            'modules.balanceManagement.step3',
            'modules.balanceManagement.step4',
          ],
        },
        {
          icon: <Receipt className="h-5 w-5" />,
          titleKey: 'modules.paymentProgress.title',
          descriptionKey: 'modules.paymentProgress.description',
          href: '/admin/payments',
          steps: [
            'modules.paymentProgress.step1',
            'modules.paymentProgress.step2',
            'modules.paymentProgress.step3',
            'modules.paymentProgress.step4',
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
            'modules.reconciliation.step3',
            'modules.reconciliation.step4',
          ],
        },
      ],
    },
    // Section 3: Customer Management
    {
      titleKey: 'sections.customerMgmt',
      icon: <Users className="h-5 w-5" />,
      modules: [
        {
          icon: <Users className="h-5 w-5" />,
          titleKey: 'modules.customers.title',
          descriptionKey: 'modules.customers.description',
          href: '/admin/customers',
          steps: [
            'modules.customers.step1',
            'modules.customers.step2',
            'modules.customers.step3',
            'modules.customers.step4',
            'modules.customers.step5',
          ],
        },
        {
          icon: <FileCheck2 className="h-5 w-5" />,
          titleKey: 'modules.contracts.title',
          descriptionKey: 'modules.contracts.description',
          href: '#',
          steps: ['modules.contracts.step1', 'modules.contracts.step2', 'modules.contracts.step3'],
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
            'modules.pricingLists.step4',
            'modules.pricingLists.step5',
          ],
        },
        {
          icon: <CreditCard className="h-5 w-5" />,
          titleKey: 'modules.credits.title',
          descriptionKey: 'modules.credits.description',
          href: '/admin/credits',
          steps: ['modules.credits.step1', 'modules.credits.step2', 'modules.credits.step3', 'modules.credits.step4'],
        },
        {
          icon: <Sparkles className="h-5 w-5" />,
          titleKey: 'modules.specialRules.title',
          descriptionKey: 'modules.specialRules.description',
          href: '/admin/special-rules',
          steps: ['modules.specialRules.step1', 'modules.specialRules.step2', 'modules.specialRules.step3'],
        },
        {
          icon: <Upload className="h-5 w-5" />,
          titleKey: 'modules.rawCostImports.title',
          descriptionKey: 'modules.rawCostImports.description',
          href: '/admin/raw-cost-imports',
          steps: ['modules.rawCostImports.step1', 'modules.rawCostImports.step2', 'modules.rawCostImports.step3', 'modules.rawCostImports.step4'],
        },
      ],
    },
    // Section 4: Operations
    {
      titleKey: 'sections.operations',
      icon: <Server className="h-5 w-5" />,
      subsections: [
        {
          titleKey: 'sections.gcp',
          icon: <Cloud className="h-5 w-5" />,
          modules: [
            {
              icon: <Database className="h-5 w-5" />,
              titleKey: 'modules.gcpSourceData.title',
              descriptionKey: 'modules.gcpSourceData.description',
              href: '/admin/gcp-connections',
              steps: ['modules.gcpSourceData.step1', 'modules.gcpSourceData.step2', 'modules.gcpSourceData.step3', 'modules.gcpSourceData.step4'],
            },
            {
              icon: <Building2 className="h-5 w-5" />,
              titleKey: 'modules.gcpBillingAccounts.title',
              descriptionKey: 'modules.gcpBillingAccounts.description',
              href: '/admin/billing-accounts',
              steps: ['modules.gcpBillingAccounts.step1', 'modules.gcpBillingAccounts.step2', 'modules.gcpBillingAccounts.step3', 'modules.gcpBillingAccounts.step4'],
            },
            {
              icon: <FolderKanban className="h-5 w-5" />,
              titleKey: 'modules.gcpProjects.title',
              descriptionKey: 'modules.gcpProjects.description',
              href: '/admin/projects',
              steps: ['modules.gcpProjects.step1', 'modules.gcpProjects.step2', 'modules.gcpProjects.step3', 'modules.gcpProjects.step4', 'modules.gcpProjects.step5'],
            },
            {
              icon: <Layers className="h-5 w-5" />,
              titleKey: 'modules.gcpSkuGroups.title',
              descriptionKey: 'modules.gcpSkuGroups.description',
              href: '/admin/sku-groups',
              steps: ['modules.gcpSkuGroups.step1', 'modules.gcpSkuGroups.step2', 'modules.gcpSkuGroups.step3', 'modules.gcpSkuGroups.step4', 'modules.gcpSkuGroups.step5'],
            },
            {
              icon: <ClipboardList className="h-5 w-5" />,
              titleKey: 'modules.gcpRegistrations.title',
              descriptionKey: 'modules.gcpRegistrations.description',
              href: '#',
              steps: ['modules.gcpRegistrations.step1', 'modules.gcpRegistrations.step2'],
            },
            {
              icon: <FileCheck2 className="h-5 w-5" />,
              titleKey: 'modules.gcpContracts.title',
              descriptionKey: 'modules.gcpContracts.description',
              href: '#',
              steps: ['modules.gcpContracts.step1', 'modules.gcpContracts.step2'],
            },
            {
              icon: <CreditCard className="h-5 w-5" />,
              titleKey: 'modules.gcpCredits.title',
              descriptionKey: 'modules.gcpCredits.description',
              href: '#',
              steps: ['modules.gcpCredits.step1', 'modules.gcpCredits.step2'],
            },
            {
              icon: <Banknote className="h-5 w-5" />,
              titleKey: 'modules.gcpFundings.title',
              descriptionKey: 'modules.gcpFundings.description',
              href: '#',
              steps: ['modules.gcpFundings.step1', 'modules.gcpFundings.step2'],
            },
          ],
        },
        {
          titleKey: 'sections.aws',
          icon: <Cloud className="h-5 w-5" />,
          modules: [
            {
              icon: <Database className="h-5 w-5" />,
              titleKey: 'modules.awsSourceData.title',
              descriptionKey: 'modules.awsSourceData.description',
              href: '#',
              steps: ['modules.awsSourceData.step1', 'modules.awsSourceData.step2'],
            },
            {
              icon: <Building2 className="h-5 w-5" />,
              titleKey: 'modules.awsPayerAccounts.title',
              descriptionKey: 'modules.awsPayerAccounts.description',
              href: '#',
              steps: ['modules.awsPayerAccounts.step1', 'modules.awsPayerAccounts.step2', 'modules.awsPayerAccounts.step3'],
            },
            {
              icon: <Link2 className="h-5 w-5" />,
              titleKey: 'modules.awsLinkedAccounts.title',
              descriptionKey: 'modules.awsLinkedAccounts.description',
              href: '#',
              steps: ['modules.awsLinkedAccounts.step1', 'modules.awsLinkedAccounts.step2', 'modules.awsLinkedAccounts.step3'],
            },
            {
              icon: <Target className="h-5 w-5" />,
              titleKey: 'modules.awsOpportunities.title',
              descriptionKey: 'modules.awsOpportunities.description',
              href: '#',
              steps: ['modules.awsOpportunities.step1', 'modules.awsOpportunities.step2'],
            },
            {
              icon: <FileCheck2 className="h-5 w-5" />,
              titleKey: 'modules.awsContracts.title',
              descriptionKey: 'modules.awsContracts.description',
              href: '#',
              steps: ['modules.awsContracts.step1', 'modules.awsContracts.step2'],
            },
            {
              icon: <CreditCard className="h-5 w-5" />,
              titleKey: 'modules.awsCredits.title',
              descriptionKey: 'modules.awsCredits.description',
              href: '#',
              steps: ['modules.awsCredits.step1', 'modules.awsCredits.step2'],
            },
            {
              icon: <Banknote className="h-5 w-5" />,
              titleKey: 'modules.awsFundings.title',
              descriptionKey: 'modules.awsFundings.description',
              href: '#',
              steps: ['modules.awsFundings.step1', 'modules.awsFundings.step2'],
            },
          ],
        },
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
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i}>{t(`quickStart.step${i + 1}`)}</li>
            ))}
          </ol>
        </div>
      </Card>

      {/* Module Sections */}
      {sections.map((section, sectionIndex) => (
        <div key={sectionIndex}>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            {section.icon}
            {t(section.titleKey)}
          </h2>

          {section.modules && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {section.modules.map((mod, index) => (
                <ModuleCard key={index} module={mod} t={t} />
              ))}
            </div>
          )}

          {section.subsections?.map((sub, subIndex) => (
            <div key={subIndex} className={subIndex > 0 ? 'mt-6' : 'mt-2'}>
              <h3 className="text-md font-medium mb-3 flex items-center gap-2 text-muted-foreground ml-1">
                {sub.icon}
                {t(sub.titleKey)}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sub.modules.map((mod, index) => (
                  <ModuleCard key={index} module={mod} t={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

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
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-primary">•</span>
              {t(`tips.tip${i + 1}`)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
