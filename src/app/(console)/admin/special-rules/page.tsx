'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Braces, Plus, Route, ShieldCheck } from 'lucide-react';
import { api, formatApiError } from '@/lib/client/api';
import {
  type Customer,
  type NullProjectAttributionConfigItem,
  type PaginatedResponse,
  type SkuGroup,
  type SpecialRule,
  type SpecialRuleType,
} from '@/lib/client/types';
import { DataTable, Button, Alert } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { Textarea } from '@/components/ui/shadcn/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Can } from '@/components/auth';

const GLOBAL_SCOPE = '__global__';
const EMPTY_SELECT_VALUE = '__none__';

type SpecialRuleFormData = {
  customerId: string;
  name: string;
  ruleType: SpecialRuleType;
  enabled: boolean;
  priority: number;
  effectiveStart: string;
  effectiveEnd: string;
  config: string;
  matchSkuId: string;
  matchSkuGroupId: string;
  matchServiceId: string;
  matchProjectId: string;
  matchBillingAccountId: string;
  costMultiplier: string;
  targetCustomerId: string;
};

const RULE_TYPES: Array<{
  value: SpecialRuleType;
  label: string;
  description: string;
}> = [
  {
    value: 'ASSIGN_NULL_PROJECT',
    label: 'Null-project attribution',
    description: 'Route project-less BigQuery rows by exact Billing ID + SKU before customer billing.',
  },
  {
    value: 'EXCLUDE_SKU',
    label: 'Exclude SKU',
    description: 'Remove matching SKU costs before pricing.',
  },
  {
    value: 'EXCLUDE_SKU_GROUP',
    label: 'Exclude SKU group',
    description: 'Remove costs belonging to a selected SKU group.',
  },
  {
    value: 'OVERRIDE_COST',
    label: 'Override cost',
    description: 'Multiply matching costs before pricing; 0 makes them free.',
  },
  {
    value: 'MOVE_TO_CUSTOMER',
    label: 'Move to customer',
    description: 'Reassign matching costs to another customer.',
  },
];

const ATTRIBUTION_TEMPLATE = JSON.stringify([
  {
    billingAccountId: '000000-000000-000000',
    skuIds: ['SKU_ID_1', 'SKU_ID_2'],
    projectId: 'shared-charges-unique-id',
  },
], null, 2);

function newRuleForm(): SpecialRuleFormData {
  return {
    customerId: GLOBAL_SCOPE,
    name: '',
    ruleType: 'ASSIGN_NULL_PROJECT',
    enabled: true,
    priority: 100,
    effectiveStart: '',
    effectiveEnd: '',
    config: ATTRIBUTION_TEMPLATE,
    matchSkuId: '',
    matchSkuGroupId: '',
    matchServiceId: '',
    matchProjectId: '',
    matchBillingAccountId: '',
    costMultiplier: '',
    targetCustomerId: '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseAttributionConfig(raw: string): NullProjectAttributionConfigItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Configuration must be valid JSON.');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Configuration must be a non-empty JSON array.');
  }

  const valid = parsed.every((item) => (
    isRecord(item)
    && typeof item.billingAccountId === 'string'
    && item.billingAccountId.trim().length > 0
    && typeof item.projectId === 'string'
    && item.projectId.trim().length > 0
    && Array.isArray(item.skuIds)
    && item.skuIds.length > 0
    && item.skuIds.every((skuId) => typeof skuId === 'string' && skuId.trim().length > 0)
  ));
  if (!valid) {
    throw new Error('Every item needs billingAccountId, a non-empty skuIds array, and projectId.');
  }

  return parsed as NullProjectAttributionConfigItem[];
}

function attributionSummary(rule: SpecialRule): string {
  if (!Array.isArray(rule.config)) return 'No mappings';
  const skuCount = rule.config.reduce((total, item) => total + item.skuIds.length, 0);
  return `${rule.config.length} route${rule.config.length === 1 ? '' : 's'} · ${skuCount} SKU${skuCount === 1 ? '' : 's'}`;
}

function matchSummary(rule: SpecialRule): string {
  const parts = [
    rule.matchSkuId ? `SKU ${rule.matchSkuId}` : null,
    rule.matchSkuGroup ? `Group ${rule.matchSkuGroup.code}` : null,
    rule.matchServiceId ? `Service ${rule.matchServiceId}` : null,
    rule.matchProjectId ? `Project ${rule.matchProjectId}` : null,
    rule.matchBillingAccountId ? `Billing ${rule.matchBillingAccountId}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'No match criteria';
}

function formatEffectivePeriod(rule: SpecialRule): string {
  if (!rule.effectiveStart && !rule.effectiveEnd) return 'Always';
  return `${rule.effectiveStart ?? 'Any time'} → ${rule.effectiveEnd ?? 'No end'}`;
}

export default function SpecialRulesPage() {
  const [rules, setRules] = useState<SpecialRule[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [skuGroups, setSkuGroups] = useState<SkuGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<SpecialRule | null>(null);
  const [formData, setFormData] = useState<SpecialRuleFormData>(newRuleForm);
  const [isSaving, setIsSaving] = useState(false);

  const fetchRules = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [rulesRes, customersRes, skuGroupsRes] = await Promise.all([
        api.get<PaginatedResponse<SpecialRule>>('/special-rules?limit=100'),
        api.get<PaginatedResponse<Customer>>('/customers?limit=100'),
        api.get<PaginatedResponse<SkuGroup>>('/sku-groups?limit=100').catch(() => null),
      ]);
      setRules(rulesRes.data ?? []);
      setCustomers(customersRes.data ?? []);
      setSkuGroups(skuGroupsRes?.data ?? []);
    } catch (err) {
      console.error('Error fetching special rules:', err);
      setError(formatApiError(err, 'Failed to load special rules'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  const getCustomerName = useCallback((customerId: string | null) => {
    if (!customerId) return 'Global';
    return customers.find((customer) => customer.id === customerId)?.name ?? customerId;
  }, [customers]);

  const handleEdit = useCallback((rule: SpecialRule) => {
    const legacyConfig = isRecord(rule.config) ? rule.config : {};
    setEditingRule(rule);
    setFormData({
      customerId: rule.customerId ?? GLOBAL_SCOPE,
      name: rule.name,
      ruleType: rule.ruleType,
      enabled: rule.enabled ?? rule.isActive,
      priority: rule.priority,
      effectiveStart: rule.effectiveStart ?? '',
      effectiveEnd: rule.effectiveEnd ?? '',
      config: rule.ruleType === 'ASSIGN_NULL_PROJECT'
        ? JSON.stringify(rule.config ?? [], null, 2)
        : '{}',
      matchSkuId: rule.matchSkuId ?? '',
      matchSkuGroupId: rule.matchSkuGroupId ?? rule.matchSkuGroup?.id ?? '',
      matchServiceId: rule.matchServiceId ?? '',
      matchProjectId: rule.matchProjectId ?? '',
      matchBillingAccountId: rule.matchBillingAccountId ?? '',
      costMultiplier: rule.costMultiplier ?? '',
      targetCustomerId: rule.targetCustomerId
        ?? rule.targetCustomer?.id
        ?? (typeof legacyConfig.targetCustomerId === 'string' ? legacyConfig.targetCustomerId : ''),
    });
    setFormError(null);
    setShowModal(true);
  }, []);

  const columns: ColumnDef<SpecialRule>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Rule',
      cell: ({ row }) => (
        <div className="min-w-[180px]">
          <div className="font-medium text-foreground">{row.original.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {row.original.ruleType === 'ASSIGN_NULL_PROJECT'
              ? attributionSummary(row.original)
              : matchSummary(row.original)}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'customerId',
      header: 'Scope',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${row.original.customerId ? 'bg-sky-500' : 'bg-amber-500'}`} />
          <span className="text-sm">{getCustomerName(row.original.customerId)}</span>
        </div>
      ),
    },
    {
      accessorKey: 'ruleType',
      header: 'Type',
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={row.original.ruleType === 'ASSIGN_NULL_PROJECT'
            ? 'border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}
        >
          {RULE_TYPES.find((type) => type.value === row.original.ruleType)?.label ?? row.original.ruleType}
        </Badge>
      ),
    },
    {
      accessorKey: 'priority',
      header: 'Priority',
      cell: ({ row }) => <span className="font-mono text-sm tabular-nums">{row.original.priority}</span>,
    },
    {
      id: 'effectivePeriod',
      header: 'Effective period',
      cell: ({ row }) => <span className="whitespace-nowrap text-sm text-muted-foreground">{formatEffectivePeriod(row.original)}</span>,
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.enabled ? 'default' : 'secondary'}>
          {row.original.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Can resource="special_rules" action="update">
          <Button variant="ghost" size="sm" onClick={() => handleEdit(row.original)}>
            Edit
          </Button>
        </Can>
      ),
    },
  ], [getCustomerName, handleEdit]);

  const handleCreate = () => {
    setEditingRule(null);
    setFormData(newRuleForm());
    setFormError(null);
    setShowModal(true);
  };

  const handleRuleTypeChange = (ruleType: SpecialRuleType) => {
    setFormData((current) => ({
      ...current,
      ruleType,
      customerId: ruleType === 'ASSIGN_NULL_PROJECT' ? GLOBAL_SCOPE : current.customerId,
      config: ruleType === 'ASSIGN_NULL_PROJECT' ? ATTRIBUTION_TEMPLATE : '{}',
    }));
  };

  const handleSubmit = async () => {
    setFormError(null);
    if (!formData.name.trim()) {
      setFormError('Rule name is required.');
      return;
    }
    if (formData.effectiveStart && formData.effectiveEnd && formData.effectiveStart > formData.effectiveEnd) {
      setFormError('Effective end must be on or after effective start.');
      return;
    }

    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: formData.name.trim(),
        enabled: formData.enabled,
        priority: formData.priority,
        effectiveStart: formData.effectiveStart || null,
        effectiveEnd: formData.effectiveEnd || null,
      };

      if (!editingRule) payload.ruleType = formData.ruleType;

      if (formData.ruleType === 'ASSIGN_NULL_PROJECT') {
        payload.config = parseAttributionConfig(formData.config);
      } else {
        payload.matchSkuId = formData.matchSkuId.trim() || null;
        payload.matchSkuGroupId = formData.matchSkuGroupId || null;
        payload.matchServiceId = formData.matchServiceId.trim() || null;
        payload.matchProjectId = formData.matchProjectId.trim() || null;
        payload.matchBillingAccountId = formData.matchBillingAccountId.trim() || null;
        payload.targetCustomerId = formData.targetCustomerId || null;

        if (formData.ruleType === 'EXCLUDE_SKU' && !formData.matchSkuId.trim()) {
          throw new Error('SKU ID is required for an Exclude SKU rule.');
        }
        if (formData.ruleType === 'EXCLUDE_SKU_GROUP' && !formData.matchSkuGroupId) {
          throw new Error('SKU group is required for an Exclude SKU group rule.');
        }
        if (formData.ruleType === 'OVERRIDE_COST') {
          const multiplier = Number(formData.costMultiplier);
          if (formData.costMultiplier.trim() === '' || !Number.isFinite(multiplier)) {
            throw new Error('A valid cost multiplier is required.');
          }
          payload.costMultiplier = multiplier;
        } else {
          payload.costMultiplier = null;
        }
        if (formData.ruleType === 'MOVE_TO_CUSTOMER' && !formData.targetCustomerId) {
          throw new Error('Target customer is required for a Move to customer rule.');
        }
      }

      if (editingRule) {
        await api.patch(`/special-rules/${editingRule.id}`, payload);
      } else if (formData.ruleType === 'ASSIGN_NULL_PROJECT' || formData.customerId === GLOBAL_SCOPE) {
        await api.post('/special-rules', payload);
      } else {
        await api.post(`/customers/${formData.customerId}/special-rules`, payload);
      }

      setShowModal(false);
      await fetchRules();
    } catch (err) {
      console.error('Error saving special rule:', err);
      setFormError(formatApiError(err, 'Failed to save special rule'));
    } finally {
      setIsSaving(false);
    }
  };

  const selectedType = RULE_TYPES.find((type) => type.value === formData.ruleType);
  const attributionRuleCount = rules.filter((rule) => rule.ruleType === 'ASSIGN_NULL_PROJECT').length;
  const enabledRuleCount = rules.filter((rule) => rule.enabled).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Billing controls</p>
          <h1 className="text-2xl font-bold tracking-tight">Special Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">Route exceptional costs and transform charges before customer pricing.</p>
        </div>
        <Can resource="special_rules" action="create">
          <Button onClick={handleCreate} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" />
            Add rule
          </Button>
        </Can>
      </div>

      {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}

      <Card className="relative overflow-hidden border-amber-200/70 bg-gradient-to-br from-amber-50 via-background to-sky-50/50 p-5 shadow-sm dark:border-amber-900/60 dark:from-amber-950/30 dark:to-sky-950/20">
        <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full border border-amber-300/30" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-2xl gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-100/80 text-amber-800 dark:border-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
              <Route className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Pre-customer attribution</h2>
                <Badge variant="outline" className="border-amber-300 bg-background/70 text-[10px] uppercase tracking-wider">Exact match</Badge>
              </div>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                Null-project rules match BigQuery rows on Billing ID + SKU, then attach them to one billable virtual project. Existing project IDs are never overwritten.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border shadow-sm">
            <div className="min-w-28 bg-background/90 px-4 py-3">
              <div className="text-xl font-semibold tabular-nums">{attributionRuleCount}</div>
              <div className="text-xs text-muted-foreground">Routing rules</div>
            </div>
            <div className="min-w-28 bg-background/90 px-4 py-3">
              <div className="text-xl font-semibold tabular-nums">{enabledRuleCount}</div>
              <div className="text-xs text-muted-foreground">Enabled total</div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <DataTable
          data={rules}
          columns={columns}
          isLoading={isLoading}
          searchable
          searchPlaceholder="Search name, scope, or rule type..."
          emptyMessage="No special rules found"
          pageSize={20}
        />
      </Card>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingRule ? 'Edit special rule' : 'Create special rule'}
        description="Configure when and how this billing rule is applied."
        size="xl"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          className="space-y-6"
        >
          {formError && <Alert variant="error" onClose={() => setFormError(null)}>{formError}</Alert>}

          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="name">Rule name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                required
                placeholder="Shared support charges"
                className="mt-1.5"
              />
            </div>
            <div className="flex h-10 items-center gap-3 rounded-md border bg-muted/30 px-3">
              <Switch
                id="enabled"
                checked={formData.enabled}
                onCheckedChange={(enabled) => setFormData({ ...formData, enabled })}
              />
              <Label htmlFor="enabled" className="cursor-pointer">Enabled</Label>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Scope *</Label>
              <Select
                value={formData.customerId}
                disabled={Boolean(editingRule) || formData.ruleType === 'ASSIGN_NULL_PROJECT'}
                onValueChange={(customerId) => setFormData({ ...formData, customerId })}
              >
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL_SCOPE}>Global</SelectItem>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {formData.ruleType === 'ASSIGN_NULL_PROJECT'
                  ? 'Attribution runs before a customer is known, so this scope is always global.'
                  : 'Global rule creation requires super admin access.'}
              </p>
            </div>
            <div>
              <Label>Rule type *</Label>
              <Select
                value={formData.ruleType}
                disabled={Boolean(editingRule)}
                onValueChange={(value) => handleRuleTypeChange(value as SpecialRuleType)}
              >
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-xs text-muted-foreground">{selectedType?.description}</p>
            </div>
          </div>

          {formData.ruleType === 'ASSIGN_NULL_PROJECT' ? (
            <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-100 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Braces className="h-4 w-4 text-amber-300" />
                  <div>
                    <div className="text-sm font-medium">Attribution mappings</div>
                    <div className="text-xs text-slate-400">One object per Billing ID → virtual project route</div>
                  </div>
                </div>
                <code className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300">billingAccountId + skuIds[] + projectId</code>
              </div>
              <div className="p-4">
                <Textarea
                  id="config"
                  aria-label="Null-project attribution JSON"
                  value={formData.config}
                  onChange={(event) => setFormData({ ...formData, config: event.target.value })}
                  required
                  rows={12}
                  spellCheck={false}
                  className="resize-y border-slate-700 bg-slate-900 font-mono text-[13px] leading-6 text-slate-100 focus-visible:ring-amber-400"
                />
                <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
                  <span>• Billing ID must already exist</span>
                  <span>• SKU IDs use exact matching</span>
                  <span>• Project must be billable and bound once</span>
                </div>
              </div>
            </section>
          ) : (
            <section className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div>
                <h3 className="text-sm font-semibold">Match criteria</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Populated criteria are combined with AND logic.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label htmlFor="matchSkuId">SKU ID</Label>
                  <Input id="matchSkuId" className="mt-1.5 font-mono text-sm" value={formData.matchSkuId} onChange={(event) => setFormData({ ...formData, matchSkuId: event.target.value })} />
                </div>
                <div>
                  <Label>SKU group</Label>
                  <Select value={formData.matchSkuGroupId || EMPTY_SELECT_VALUE} onValueChange={(value) => setFormData({ ...formData, matchSkuGroupId: value === EMPTY_SELECT_VALUE ? '' : value })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="Any group" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={EMPTY_SELECT_VALUE}>Any group</SelectItem>
                      {skuGroups.map((group) => <SelectItem key={group.id} value={group.id}>{group.code} · {group.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="matchServiceId">Service ID</Label>
                  <Input id="matchServiceId" className="mt-1.5 font-mono text-sm" value={formData.matchServiceId} onChange={(event) => setFormData({ ...formData, matchServiceId: event.target.value })} />
                </div>
                <div>
                  <Label htmlFor="matchProjectId">Project ID</Label>
                  <Input id="matchProjectId" className="mt-1.5 font-mono text-sm" value={formData.matchProjectId} onChange={(event) => setFormData({ ...formData, matchProjectId: event.target.value })} />
                </div>
                <div>
                  <Label htmlFor="matchBillingAccountId">Billing account ID</Label>
                  <Input id="matchBillingAccountId" className="mt-1.5 font-mono text-sm" value={formData.matchBillingAccountId} onChange={(event) => setFormData({ ...formData, matchBillingAccountId: event.target.value })} />
                </div>
                {formData.ruleType === 'OVERRIDE_COST' && (
                  <div>
                    <Label htmlFor="costMultiplier">Cost multiplier *</Label>
                    <Input id="costMultiplier" type="number" min="0" max="10" step="0.000001" className="mt-1.5 font-mono text-sm" placeholder="0.85" value={formData.costMultiplier} onChange={(event) => setFormData({ ...formData, costMultiplier: event.target.value })} />
                  </div>
                )}
                {formData.ruleType === 'MOVE_TO_CUSTOMER' && (
                  <div>
                    <Label>Target customer *</Label>
                    <Select value={formData.targetCustomerId || EMPTY_SELECT_VALUE} onValueChange={(value) => setFormData({ ...formData, targetCustomerId: value === EMPTY_SELECT_VALUE ? '' : value })}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select customer" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={EMPTY_SELECT_VALUE}>Select customer</SelectItem>
                        {customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </section>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="priority">Priority</Label>
              <Input id="priority" type="number" min={0} max={9999} className="mt-1.5" value={formData.priority} onChange={(event) => setFormData({ ...formData, priority: Number(event.target.value) || 0 })} />
              <p className="mt-1.5 text-xs text-muted-foreground">Lower values run first.</p>
            </div>
            <div>
              <Label htmlFor="effectiveStart">Effective start</Label>
              <Input id="effectiveStart" type="date" className="mt-1.5" value={formData.effectiveStart} onChange={(event) => setFormData({ ...formData, effectiveStart: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="effectiveEnd">Effective end</Label>
              <Input id="effectiveEnd" type="date" className="mt-1.5" value={formData.effectiveEnd} onChange={(event) => setFormData({ ...formData, effectiveEnd: event.target.value })} />
            </div>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            Rules are evaluated by billing month; any date overlap activates the rule for that whole month.
          </p>

          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              Conflicts and invalid references are rejected before save.
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button type="submit" isLoading={isSaving}>{editingRule ? 'Save changes' : 'Create rule'}</Button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
