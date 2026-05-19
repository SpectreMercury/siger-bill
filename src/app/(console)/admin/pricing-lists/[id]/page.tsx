'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { SkuGroup, PaginatedResponse } from '@/lib/client/types';
import { DataTable, Alert } from '@/components/ui';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Modal } from '@/components/ui/Modal';
import { Can } from '@/components/auth';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  Percent,
  DollarSign,
  Layers,
  Star,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RuleType = 'LIST_DISCOUNT' | 'UNIT_PRICE' | 'TIERED';

interface PricingTier {
  from: number;
  to: number | null;
  rate?: number | null;
  unitPrice?: number | null;
}

interface PricingRule {
  id: string;
  isDefault: boolean;
  ruleType: RuleType;
  discountRate: string | null;
  discountPercent: string | null;
  unitPrice: string | null;
  tiers: PricingTier[] | null;
  skuGroups: Array<{ id: string; code: string; name: string }>;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  createdAt: string;
}

interface PricingListDetail {
  id: string;
  name: string;
  status: string;
  isActive: boolean;
  customer: { id: string; name: string; externalId: string | null };
  rules: PricingRule[];
  createdAt: string;
  updatedAt: string;
}

interface TierRow {
  from: string;
  to: string;
  rate: string;
  unitPrice: string;
}

const defaultTierRow = (): TierRow => ({ from: '0', to: '', rate: '', unitPrice: '' });

interface RuleFormData {
  ruleType: RuleType;
  skuGroupIds: string[];      // multi-select
  // LIST_DISCOUNT
  discountPercent: string;
  // UNIT_PRICE
  unitPrice: string;
  // TIERED
  tiers: TierRow[];
  // common
  effectiveStart: string;
  effectiveEnd: string;
}

const defaultForm = (): RuleFormData => ({
  ruleType: 'LIST_DISCOUNT',
  skuGroupIds: [],
  discountPercent: '10',
  unitPrice: '',
  tiers: [defaultTierRow(), { from: '', to: '', rate: '', unitPrice: '' }],
  effectiveStart: '',
  effectiveEnd: '',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRuleValue(rule: PricingRule): React.ReactNode {
  if (rule.ruleType === 'LIST_DISCOUNT') {
    return (
      <Badge variant="secondary" className="font-mono">
        <Percent className="h-3 w-3 mr-1" />
        {rule.discountPercent ?? '-'}
      </Badge>
    );
  }
  if (rule.ruleType === 'UNIT_PRICE') {
    return (
      <Badge variant="secondary" className="font-mono">
        <DollarSign className="h-3 w-3 mr-1" />
        {rule.unitPrice ?? '-'}
      </Badge>
    );
  }
  if (rule.ruleType === 'TIERED' && rule.tiers) {
    return (
      <div className="space-y-0.5">
        {rule.tiers.map((tier, i) => (
          <div key={i} className="text-xs font-mono text-muted-foreground">
            ${tier.from.toLocaleString()}
            {tier.to != null ? `–$${tier.to.toLocaleString()}` : '+'}
            {' → '}
            {tier.rate != null
              ? `${((1 - tier.rate) * 100).toFixed(0)}% off`
              : `$${tier.unitPrice}`}
          </div>
        ))}
      </div>
    );
  }
  return '-';
}

function ruleTypeBadgeVariant(type: RuleType): 'default' | 'secondary' | 'outline' {
  if (type === 'LIST_DISCOUNT') return 'secondary';
  if (type === 'UNIT_PRICE') return 'default';
  return 'outline';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PricingListDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('pricingLists');
  const tc = useTranslations('common');

  const [pricingList, setPricingList] = useState<PricingListDetail | null>(null);
  const [allSkuGroups, setAllSkuGroups] = useState<SkuGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingRule, setDeletingRule] = useState<PricingRule | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formData, setFormData] = useState<RuleFormData>(defaultForm());
  const [groupFilter, setGroupFilter] = useState('');

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [listResponse, skuGroupsResponse] = await Promise.all([
        api.get<PricingListDetail>(`/pricing-lists/${params.id}`),
        api.get<PaginatedResponse<SkuGroup>>('/sku-groups?limit=1000'),
      ]);
      setPricingList(listResponse);
      setAllSkuGroups(skuGroupsResponse.data || []);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError(t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [params.id, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Groups currently assigned to the default rule — these are the only ones
  // selectable when creating a new explicit rule (invariant: one rule per group).
  const defaultRuleGroups = useMemo(() => {
    if (!pricingList) return [];
    const def = pricingList.rules.find((r) => r.isDefault);
    return def?.skuGroups ?? [];
  }, [pricingList]);

  const filteredDefaultGroups = useMemo(() => {
    const q = groupFilter.trim().toLowerCase();
    if (!q) return defaultRuleGroups;
    return defaultRuleGroups.filter(
      (g) => g.code.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)
    );
  }, [defaultRuleGroups, groupFilter]);

  // ---------------------------------------------------------------------------
  // Table columns
  // ---------------------------------------------------------------------------

  const columns: ColumnDef<PricingRule>[] = useMemo(
    () => [
      {
        accessorKey: 'isDefault',
        header: '',
        cell: ({ row }) =>
          row.original.isDefault ? (
            <Badge variant="default" className="text-xs gap-1">
              <Star className="h-3 w-3" />
              {t('detail.defaultBadge')}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {t('detail.explicitBadge')}
            </Badge>
          ),
      },
      {
        accessorKey: 'ruleType',
        header: t('detail.ruleType'),
        cell: ({ row }) => (
          <Badge variant={ruleTypeBadgeVariant(row.original.ruleType)} className="text-xs">
            {t(`detail.ruleTypes.${row.original.ruleType}` as never)}
          </Badge>
        ),
      },
      {
        accessorKey: 'skuGroups',
        header: t('detail.skuGroup'),
        cell: ({ row }) => {
          const rule = row.original;
          if (rule.isDefault) {
            return (
              <div className="text-sm">
                <div className="text-muted-foreground">
                  {t('detail.defaultCoversAll', { count: rule.skuGroups.length })}
                </div>
              </div>
            );
          }
          const max = 3;
          const shown = rule.skuGroups.slice(0, max);
          const more = rule.skuGroups.length - shown.length;
          return (
            <div className="flex flex-wrap gap-1">
              {shown.map((g) => (
                <Badge key={g.id} variant="secondary" className="font-mono text-xs">
                  {g.code}
                </Badge>
              ))}
              {more > 0 && (
                <Badge variant="outline" className="text-xs">
                  +{more}
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        id: 'value',
        header: t('detail.value'),
        cell: ({ row }) => formatRuleValue(row.original),
      },
      {
        accessorKey: 'effectiveStart',
        header: t('detail.effectivePeriod'),
        cell: ({ row }) => {
          const start = row.original.effectiveStart;
          const end = row.original.effectiveEnd;
          if (!start && !end) return <span className="text-muted-foreground text-xs">{t('detail.always')}</span>;
          return (
            <span className="text-xs">
              {start ? new Date(start).toLocaleDateString() : '∞'} –{' '}
              {end ? new Date(end).toLocaleDateString() : '∞'}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.isDefault ? null : (
            <Can resource="customers" action="delete">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => handleDeleteClick(row.original)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Can>
          ),
      },
    ],
    [t]
  );

  // ---------------------------------------------------------------------------
  // Form helpers
  // ---------------------------------------------------------------------------

  const pf = (patch: Partial<RuleFormData>) =>
    setFormData((f) => ({ ...f, ...patch }));

  const toggleSkuGroup = (id: string) =>
    setFormData((f) => ({
      ...f,
      skuGroupIds: f.skuGroupIds.includes(id)
        ? f.skuGroupIds.filter((x) => x !== id)
        : [...f.skuGroupIds, id],
    }));

  const selectAllVisible = () =>
    setFormData((f) => ({
      ...f,
      skuGroupIds: Array.from(new Set([...f.skuGroupIds, ...filteredDefaultGroups.map((g) => g.id)])),
    }));

  const clearSelection = () =>
    setFormData((f) => ({ ...f, skuGroupIds: [] }));

  const updateTier = (i: number, patch: Partial<TierRow>) =>
    setFormData((f) => {
      const tiers = [...f.tiers];
      tiers[i] = { ...tiers[i], ...patch };
      return { ...f, tiers };
    });

  const addTier = () =>
    setFormData((f) => ({ ...f, tiers: [...f.tiers, defaultTierRow()] }));

  const removeTier = (i: number) =>
    setFormData((f) => ({ ...f, tiers: f.tiers.filter((_, idx) => idx !== i) }));

  const syncTierFrom = (i: number, toValue: string) => {
    setFormData((f) => {
      const tiers = [...f.tiers];
      tiers[i] = { ...tiers[i], to: toValue };
      if (i + 1 < tiers.length && toValue) {
        tiers[i + 1] = { ...tiers[i + 1], from: toValue };
      }
      return { ...f, tiers };
    });
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handleSubmit = async () => {
    if (formData.skuGroupIds.length === 0) {
      setError(t('detail.errors.atLeastOneGroup'));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {
        ruleType: formData.ruleType,
        skuGroupIds: formData.skuGroupIds,
        effectiveStart: formData.effectiveStart || null,
        effectiveEnd: formData.effectiveEnd || null,
      };

      if (formData.ruleType === 'LIST_DISCOUNT') {
        const pct = parseFloat(formData.discountPercent);
        payload.discountRate = 1 - pct / 100;
      } else if (formData.ruleType === 'UNIT_PRICE') {
        payload.unitPrice = parseFloat(formData.unitPrice);
      } else {
        payload.tiers = formData.tiers
          .filter((t) => t.from !== '')
          .map((t) => {
            const tier: Record<string, unknown> = {
              from: parseFloat(t.from) || 0,
              to: t.to ? parseFloat(t.to) : null,
            };
            if (t.rate) {
              tier.rate = 1 - parseFloat(t.rate) / 100;
            } else if (t.unitPrice) {
              tier.unitPrice = parseFloat(t.unitPrice);
            }
            return tier;
          });
      }

      await api.post(`/pricing-lists/${params.id}/rules`, payload);
      setShowAddModal(false);
      fetchData();
    } catch (err) {
      console.error('Error adding rule:', err);
      setError(err instanceof Error ? err.message : t('detail.addRuleFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = (rule: PricingRule) => {
    setDeletingRule(rule);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!deletingRule) return;
    setIsDeleting(true);
    setError(null);
    try {
      await api.delete(`/pricing-rules/${deletingRule.id}`);
      setShowDeleteModal(false);
      setDeletingRule(null);
      fetchData();
    } catch (err) {
      console.error('Error deleting rule:', err);
      setError(err instanceof Error ? err.message : t('detail.deleteRuleFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pricingList) {
    return (
      <div className="space-y-6">
        <Alert variant="error">{t('notFound')}</Alert>
        <Button variant="outline" onClick={() => router.push('/admin/pricing-lists')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {tc('back')}
        </Button>
      </div>
    );
  }

  const totalGroups = allSkuGroups.length;
  const explicitlyCoveredGroups = pricingList.rules
    .filter((r) => !r.isDefault)
    .reduce((acc, r) => acc + r.skuGroups.length, 0);
  const defaultCoveredGroups = defaultRuleGroups.length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/admin/pricing-lists')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{pricingList.name}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {pricingList.customer.name}
              {pricingList.customer.externalId && ` (${pricingList.customer.externalId})`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-12 sm:ml-0">
          <Badge variant={pricingList.isActive ? 'default' : 'secondary'}>
            {pricingList.isActive ? tc('active') : tc('inactive')}
          </Badge>
        </div>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Coverage summary */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground mr-2">{t('detail.coverage.total')}:</span>
            <span className="font-semibold">{totalGroups}</span>
          </div>
          <div>
            <span className="text-muted-foreground mr-2">{t('detail.coverage.default')}:</span>
            <span className="font-semibold">{defaultCoveredGroups}</span>
          </div>
          <div>
            <span className="text-muted-foreground mr-2">{t('detail.coverage.explicit')}:</span>
            <span className="font-semibold">{explicitlyCoveredGroups}</span>
          </div>
        </div>
      </Card>

      {/* Rules Section */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Percent className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t('detail.rules')}</h2>
          </div>
          <Can resource="customers" action="update">
            <Button
              onClick={() => {
                setFormData(defaultForm());
                setGroupFilter('');
                setShowAddModal(true);
              }}
              disabled={defaultRuleGroups.length === 0}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('detail.addRule')}
            </Button>
          </Can>
        </div>

        <DataTable
          data={pricingList.rules}
          columns={columns}
          isLoading={false}
          emptyMessage={t('detail.noRules')}
          pageSize={20}
        />
      </Card>

      {/* ================================================================
          Add Rule Modal
          ================================================================ */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={t('detail.addRuleTitle')}
        size="lg"
      >
        <div className="space-y-5">
          {/* Rule Type selector */}
          <div>
            <Label className="text-sm font-medium mb-2 block">{t('detail.ruleType')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {(['LIST_DISCOUNT', 'UNIT_PRICE', 'TIERED'] as RuleType[]).map((type) => {
                const Icon = type === 'LIST_DISCOUNT' ? Percent : type === 'UNIT_PRICE' ? DollarSign : Layers;
                const isActive = formData.ruleType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => pf({ ruleType: type })}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-sm transition-colors ${
                      isActive
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border hover:border-primary/40 hover:bg-muted/40 text-muted-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="font-medium">{t(`detail.ruleTypes.${type}` as never)}</span>
                    <span className="text-xs text-center leading-tight opacity-75">
                      {t(`detail.ruleTypeHints.${type}` as never)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SKU Groups multi-select */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                {t('detail.skuGroupsSelect')}{' '}
                <span className="text-muted-foreground font-normal">
                  ({t('detail.selected', { n: formData.skuGroupIds.length, total: defaultRuleGroups.length })})
                </span>
              </Label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllVisible}
                  className="text-xs text-primary hover:underline"
                >
                  {t('detail.selectAllVisible')}
                </button>
                <span className="text-xs text-muted-foreground">|</span>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-xs text-primary hover:underline"
                >
                  {tc('clear')}
                </button>
              </div>
            </div>
            <Input
              placeholder={t('detail.searchGroup')}
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="h-9"
            />
            <div className="border rounded-lg max-h-64 overflow-y-auto">
              {filteredDefaultGroups.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  {defaultRuleGroups.length === 0
                    ? t('detail.noGroupsInDefault')
                    : t('detail.noGroupsMatch')}
                </div>
              ) : (
                filteredDefaultGroups.map((g) => {
                  const checked = formData.skuGroupIds.includes(g.id);
                  return (
                    <label
                      key={g.id}
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 border-b last:border-b-0 ${
                        checked ? 'bg-primary/5' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSkuGroup(g.id)}
                        className="rounded"
                      />
                      <Badge variant="secondary" className="font-mono text-xs">{g.code}</Badge>
                      <span className="text-sm text-muted-foreground">{g.name}</span>
                    </label>
                  );
                })
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('detail.skuGroupsHint')}</p>
          </div>

          {/* ---- LIST_DISCOUNT fields ---- */}
          {formData.ruleType === 'LIST_DISCOUNT' && (
            <div className="space-y-1.5">
              <Label htmlFor="discountPercent">
                {t('detail.discountPercent')} <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    id="discountPercent"
                    type="number"
                    value={formData.discountPercent}
                    onChange={(e) => pf({ discountPercent: e.target.value })}
                    min={0}
                    max={100}
                    step={0.1}
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                </div>
                {formData.discountPercent && (
                  <div className="text-sm text-muted-foreground whitespace-nowrap">
                    {t('detail.discountPaysHint')}{' '}
                    <span className="font-semibold text-foreground">
                      {(100 - parseFloat(formData.discountPercent || '0')).toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t('detail.discountHint')}</p>
              <div className="text-xs bg-muted/50 rounded px-3 py-2 font-mono">
                {t('detail.discountExample')}
              </div>
            </div>
          )}

          {/* ---- UNIT_PRICE fields ---- */}
          {formData.ruleType === 'UNIT_PRICE' && (
            <div className="space-y-1.5">
              <Label htmlFor="unitPrice">
                {t('detail.unitPrice')} <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="unitPrice"
                  type="number"
                  value={formData.unitPrice}
                  onChange={(e) => pf({ unitPrice: e.target.value })}
                  min={0}
                  step={0.00000001}
                  className="pl-7"
                  placeholder="0.0000"
                />
              </div>
              <p className="text-xs text-muted-foreground">{t('detail.unitPriceHint')}</p>
            </div>
          )}

          {/* ---- TIERED fields ---- */}
          {formData.ruleType === 'TIERED' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('detail.tiers')}</Label>
                <Button type="button" variant="ghost" size="sm" onClick={addTier}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('detail.addTier')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('detail.tiersHint')}</p>

              <div className="border rounded-lg overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-0 bg-muted/50 text-xs font-medium text-muted-foreground">
                  <div className="px-3 py-2">{t('detail.tierFrom')} ($)</div>
                  <div className="px-3 py-2">{t('detail.tierTo')} ($)</div>
                  <div className="px-3 py-2">{t('detail.tierRate')} (%)</div>
                  <div className="px-3 py-2">{t('detail.tierUnitPrice')} ($)</div>
                  <div className="px-3 py-2 w-16" />
                </div>

                {formData.tiers.map((tier, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-0 border-t"
                  >
                    <div className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={tier.from}
                        onChange={(e) => updateTier(i, { from: e.target.value })}
                        min={0}
                        placeholder="0"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={tier.to}
                        onChange={(e) => syncTierFrom(i, e.target.value)}
                        min={0}
                        placeholder={t('detail.tierUnbounded')}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={tier.rate}
                        onChange={(e) => updateTier(i, { rate: e.target.value, unitPrice: '' })}
                        min={0}
                        max={100}
                        step={0.1}
                        placeholder="10"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="px-2 py-1.5">
                      <Input
                        type="number"
                        value={tier.unitPrice}
                        onChange={(e) => updateTier(i, { unitPrice: e.target.value, rate: '' })}
                        min={0}
                        step={0.01}
                        placeholder="—"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="px-2 py-1.5 flex items-center justify-center w-16">
                      {formData.tiers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTier(i)}
                          className="text-destructive hover:text-destructive/80 p-1 rounded"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Effective dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="effectiveStart">{t('detail.effectiveStart')}</Label>
              <Input
                id="effectiveStart"
                type="date"
                value={formData.effectiveStart}
                onChange={(e) => pf({ effectiveStart: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="effectiveEnd">{t('detail.effectiveEnd')}</Label>
              <Input
                id="effectiveEnd"
                type="date"
                value={formData.effectiveEnd}
                onChange={(e) => pf({ effectiveEnd: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
              {tc('cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSaving || formData.skuGroupIds.length === 0}
            >
              {isSaving ? tc('saving') : tc('add')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ================================================================
          Delete Rule Confirmation
          ================================================================ */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setDeletingRule(null); }}
        title={t('detail.deleteRuleTitle')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            {t('detail.deleteRuleConfirm', { n: deletingRule?.skuGroups.length ?? 0 })}
          </p>
          {deletingRule && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-2">
              <Badge variant={ruleTypeBadgeVariant(deletingRule.ruleType)} className="text-xs">
                {t(`detail.ruleTypes.${deletingRule.ruleType}` as never)}
              </Badge>
              <div className="flex flex-wrap gap-1">
                {deletingRule.skuGroups.slice(0, 8).map((g) => (
                  <Badge key={g.id} variant="secondary" className="font-mono text-xs">{g.code}</Badge>
                ))}
                {deletingRule.skuGroups.length > 8 && (
                  <Badge variant="outline" className="text-xs">+{deletingRule.skuGroups.length - 8}</Badge>
                )}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => { setShowDeleteModal(false); setDeletingRule(null); }}>
              {tc('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {tc('delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
