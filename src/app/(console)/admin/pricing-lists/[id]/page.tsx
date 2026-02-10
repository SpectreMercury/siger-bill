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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Modal } from '@/components/ui/Modal';
import { Can } from '@/components/auth';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  Percent,
} from 'lucide-react';

interface PricingRule {
  id: string;
  ruleType: string;
  discountRate: string;
  discountPercent: string;
  skuGroup: {
    id: string;
    code: string;
    name: string;
  } | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  priority: number;
  createdAt: string;
}

interface PricingListDetail {
  id: string;
  name: string;
  status: string;
  isActive: boolean;
  customer: {
    id: string;
    name: string;
    externalId: string | null;
  };
  rules: PricingRule[];
  createdAt: string;
  updatedAt: string;
}

interface RuleFormData {
  skuGroupId: string;
  discountPercent: number;
  effectiveStart: string;
  effectiveEnd: string;
  priority: number;
}

export default function PricingListDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('pricingLists');
  const tc = useTranslations('common');

  const [pricingList, setPricingList] = useState<PricingListDetail | null>(null);
  const [skuGroups, setSkuGroups] = useState<SkuGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingRule, setDeletingRule] = useState<PricingRule | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [formData, setFormData] = useState<RuleFormData>({
    skuGroupId: '',
    discountPercent: 10,
    effectiveStart: '',
    effectiveEnd: '',
    priority: 0,
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [listResponse, skuGroupsResponse] = await Promise.all([
        api.get<PricingListDetail>(`/pricing-lists/${params.id}`),
        api.get<PaginatedResponse<SkuGroup>>('/sku-groups'),
      ]);
      setPricingList(listResponse);
      setSkuGroups(skuGroupsResponse.data || []);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError(t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [params.id, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const columns: ColumnDef<PricingRule>[] = useMemo(
    () => [
      {
        accessorKey: 'skuGroup',
        header: t('detail.skuGroup'),
        cell: ({ row }) =>
          row.original.skuGroup ? (
            <div>
              <div className="font-medium">{row.original.skuGroup.name}</div>
              <div className="text-xs text-muted-foreground">{row.original.skuGroup.code}</div>
            </div>
          ) : (
            <span className="text-muted-foreground">{t('detail.allSkus')}</span>
          ),
      },
      {
        accessorKey: 'discountPercent',
        header: t('detail.discount'),
        cell: ({ row }) => (
          <Badge variant="secondary" className="font-mono">
            <Percent className="h-3 w-3 mr-1" />
            {row.original.discountPercent}
          </Badge>
        ),
      },
      {
        accessorKey: 'priority',
        header: t('detail.priority'),
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.priority}</span>
        ),
      },
      {
        accessorKey: 'effectiveStart',
        header: t('detail.effectivePeriod'),
        cell: ({ row }) => {
          const start = row.original.effectiveStart;
          const end = row.original.effectiveEnd;
          if (!start && !end) return <span className="text-muted-foreground">{t('detail.always')}</span>;
          return (
            <span className="text-sm">
              {start ? new Date(start).toLocaleDateString() : '∞'} ~ {end ? new Date(end).toLocaleDateString() : '∞'}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
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

  const handleAddRule = () => {
    setFormData({
      skuGroupId: '',
      discountPercent: 10,
      effectiveStart: '',
      effectiveEnd: '',
      priority: 0,
    });
    setShowAddModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    setError(null);

    try {
      // Convert discount percent to discount rate (e.g., 10% discount -> 0.90 rate)
      const discountRate = 1 - formData.discountPercent / 100;

      await api.post(`/pricing-lists/${params.id}/rules`, {
        ruleType: 'LIST_DISCOUNT',
        discountRate,
        skuGroupId: formData.skuGroupId || null,
        effectiveStart: formData.effectiveStart || null,
        effectiveEnd: formData.effectiveEnd || null,
        priority: formData.priority,
      });

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/admin/pricing-lists')}
          >
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

      {/* Rules Section */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Percent className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t('detail.rules')}</h2>
          </div>
          <Can resource="customers" action="update">
            <Button onClick={handleAddRule}>
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

      {/* Add Rule Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={t('detail.addRuleTitle')}
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="skuGroupId">{t('detail.skuGroup')}</Label>
            <Select
              value={formData.skuGroupId}
              onValueChange={(value) => setFormData({ ...formData, skuGroupId: value === 'all' ? '' : value })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('detail.selectSkuGroup')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('detail.allSkus')}</SelectItem>
                {skuGroups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name} ({group.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('detail.skuGroupHint')}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="discountPercent">{t('detail.discountPercent')} *</Label>
            <div className="relative">
              <Input
                id="discountPercent"
                type="number"
                value={formData.discountPercent}
                onChange={(e) => setFormData({ ...formData, discountPercent: parseFloat(e.target.value) || 0 })}
                min={0}
                max={100}
                step={0.1}
                required
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
            </div>
            <p className="text-xs text-muted-foreground">{t('detail.discountHint')}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="effectiveStart">{t('detail.effectiveStart')}</Label>
              <Input
                id="effectiveStart"
                type="date"
                value={formData.effectiveStart}
                onChange={(e) => setFormData({ ...formData, effectiveStart: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="effectiveEnd">{t('detail.effectiveEnd')}</Label>
              <Input
                id="effectiveEnd"
                type="date"
                value={formData.effectiveEnd}
                onChange={(e) => setFormData({ ...formData, effectiveEnd: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">{t('detail.priority')}</Label>
            <Input
              id="priority"
              type="number"
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
              min={0}
            />
            <p className="text-xs text-muted-foreground">{t('detail.priorityHint')}</p>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {tc('add')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Rule Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setDeletingRule(null); }}
        title={t('detail.deleteRuleTitle')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            {t('detail.deleteRuleConfirm')}
          </p>
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
