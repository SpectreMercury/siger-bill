'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { DataTable, Alert } from '@/components/ui';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Can } from '@/components/auth';
import { Plus, Edit, Trash2 } from 'lucide-react';

interface PricingRule {
  id: string;
  pricingListId: string;
  ruleType: 'LIST_DISCOUNT' | 'TIER_PRICING' | 'SKU_OVERRIDE';
  skuGroupId: string | null;
  skuGroup?: { code: string; name: string } | null;
  discountRate: string | null;
  tierConfig: object | null;
  priority: number;
  isActive: boolean;
}

interface CustomerPricingList {
  id: string;
  customerId: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  priority: number;
  rules: PricingRule[];
}

interface CustomerPricingTabProps {
  customerId: string;
}

const RULE_TYPES = [
  { value: 'LIST_DISCOUNT', label: 'List Discount', description: 'Percentage discount on list price' },
  { value: 'TIER_PRICING', label: 'Tier Pricing', description: 'Volume-based pricing tiers' },
];

const DEFAULT_TIER_CONFIG = {
  tiers: [
    { minAmount: 0, maxAmount: 1000, discountPercent: 5 },
    { minAmount: 1000, maxAmount: 5000, discountPercent: 10 },
    { minAmount: 5000, maxAmount: null, discountPercent: 15 },
  ],
};

export function CustomerPricingTab({ customerId }: CustomerPricingTabProps) {
  const [pricingLists, setPricingLists] = useState<CustomerPricingList[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showListModal, setShowListModal] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingList, setEditingList] = useState<CustomerPricingList | null>(null);
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [listFormData, setListFormData] = useState({
    name: '',
    effectiveFrom: '',
    effectiveTo: '',
    priority: 0,
  });

  const [ruleFormData, setRuleFormData] = useState({
    ruleType: 'LIST_DISCOUNT' as 'LIST_DISCOUNT' | 'TIER_PRICING',
    discountRate: '',
    tierConfig: JSON.stringify(DEFAULT_TIER_CONFIG, null, 2),
    priority: 0,
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<{ data: CustomerPricingList[] }>(`/customers/${customerId}/pricing-lists`);
      setPricingLists(response.data || []);
    } catch (err) {
      console.error('Error fetching pricing lists:', err);
      setError('Failed to load pricing lists');
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateList = () => {
    setEditingList(null);
    setListFormData({
      name: '',
      effectiveFrom: new Date().toISOString().split('T')[0],
      effectiveTo: '',
      priority: 0,
    });
    setShowListModal(true);
  };

  const handleEditList = (list: CustomerPricingList) => {
    setEditingList(list);
    setListFormData({
      name: list.name,
      effectiveFrom: list.effectiveFrom.split('T')[0],
      effectiveTo: list.effectiveTo ? list.effectiveTo.split('T')[0] : '',
      priority: list.priority,
    });
    setShowListModal(true);
  };

  const handleSubmitList = async () => {
    setIsSaving(true);
    try {
      const payload = {
        ...listFormData,
        effectiveTo: listFormData.effectiveTo || null,
      };

      if (editingList) {
        await api.put(`/pricing-lists/${editingList.id}`, payload);
      } else {
        await api.post(`/customers/${customerId}/pricing-lists`, payload);
      }
      setShowListModal(false);
      fetchData();
    } catch (err) {
      console.error('Error saving pricing list:', err);
      setError('Failed to save pricing list');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateRule = (listId: string) => {
    setSelectedListId(listId);
    setEditingRule(null);
    setRuleFormData({
      ruleType: 'LIST_DISCOUNT',
      discountRate: '10',
      tierConfig: JSON.stringify(DEFAULT_TIER_CONFIG, null, 2),
      priority: 0,
    });
    setShowRuleModal(true);
  };

  const handleEditRule = (listId: string, rule: PricingRule) => {
    setSelectedListId(listId);
    setEditingRule(rule);
    setRuleFormData({
      ruleType: rule.ruleType as 'LIST_DISCOUNT' | 'TIER_PRICING',
      discountRate: rule.discountRate || '',
      tierConfig: rule.tierConfig ? JSON.stringify(rule.tierConfig, null, 2) : JSON.stringify(DEFAULT_TIER_CONFIG, null, 2),
      priority: rule.priority,
    });
    setShowRuleModal(true);
  };

  const handleSubmitRule = async () => {
    if (!selectedListId) return;
    setIsSaving(true);

    try {
      let config: object = {};
      if (ruleFormData.ruleType === 'LIST_DISCOUNT') {
        config = { discountRate: parseFloat(ruleFormData.discountRate) / 100 };
      } else if (ruleFormData.ruleType === 'TIER_PRICING') {
        try {
          config = JSON.parse(ruleFormData.tierConfig);
        } catch {
          setError('Invalid tier configuration JSON');
          setIsSaving(false);
          return;
        }
      }

      const payload = {
        ruleType: ruleFormData.ruleType,
        discountRate: ruleFormData.ruleType === 'LIST_DISCOUNT' ? parseFloat(ruleFormData.discountRate) / 100 : null,
        tierConfig: ruleFormData.ruleType === 'TIER_PRICING' ? config : null,
        priority: ruleFormData.priority,
      };

      if (editingRule) {
        await api.put(`/pricing-lists/${selectedListId}/rules/${editingRule.id}`, payload);
      } else {
        await api.post(`/pricing-lists/${selectedListId}/rules`, payload);
      }
      setShowRuleModal(false);
      fetchData();
    } catch (err) {
      console.error('Error saving rule:', err);
      setError('Failed to save rule');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRule = async (listId: string, ruleId: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;

    try {
      await api.delete(`/pricing-lists/${listId}/rules/${ruleId}`);
      fetchData();
    } catch (err) {
      console.error('Error deleting rule:', err);
      setError('Failed to delete rule');
    }
  };

  const ruleColumns: ColumnDef<PricingRule>[] = useMemo(
    () => [
      {
        accessorKey: 'ruleType',
        header: 'Type',
        cell: ({ row }) => (
          <Badge variant="secondary">
            {row.original.ruleType.replace('_', ' ')}
          </Badge>
        ),
      },
      {
        accessorKey: 'discountRate',
        header: 'Discount',
        cell: ({ row }) => {
          if (row.original.ruleType === 'LIST_DISCOUNT' && row.original.discountRate) {
            return `${(parseFloat(row.original.discountRate) * 100).toFixed(1)}%`;
          }
          return '-';
        },
      },
      {
        accessorKey: 'priority',
        header: 'Priority',
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono">
            {row.original.priority}
          </Badge>
        ),
      },
      {
        accessorKey: 'isActive',
        header: 'Status',
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
            {row.original.isActive ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Pricing Lists</h3>
        <Can resource="pricing" action="create">
          <Button onClick={handleCreateList}>
            <Plus className="h-4 w-4 mr-2" />
            Add Pricing List
          </Button>
        </Can>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Card className="p-6">
          <div className="text-center text-muted-foreground">Loading...</div>
        </Card>
      ) : pricingLists.length === 0 ? (
        <Card className="p-6">
          <div className="text-center text-muted-foreground">No pricing lists for this customer</div>
        </Card>
      ) : (
        pricingLists.map((list) => (
          <Card key={list.id} className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold">{list.name}</h4>
                  <Badge variant={list.isActive ? 'default' : 'secondary'}>
                    {list.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Effective: {new Date(list.effectiveFrom).toLocaleDateString()}
                  {list.effectiveTo && ` - ${new Date(list.effectiveTo).toLocaleDateString()}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Can resource="pricing" action="update">
                  <Button variant="ghost" size="sm" onClick={() => handleEditList(list)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                </Can>
                <Can resource="pricing" action="create">
                  <Button variant="outline" size="sm" onClick={() => handleCreateRule(list.id)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Rule
                  </Button>
                </Can>
              </div>
            </div>

            {list.rules && list.rules.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Type</th>
                      <th className="px-4 py-2 text-left font-medium">Discount</th>
                      <th className="px-4 py-2 text-left font-medium">Priority</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                      <th className="px-4 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.rules.map((rule) => (
                      <tr key={rule.id} className="border-t">
                        <td className="px-4 py-2">
                          <Badge variant="secondary">
                            {rule.ruleType.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          {rule.ruleType === 'LIST_DISCOUNT' && rule.discountRate
                            ? `${(parseFloat(rule.discountRate) * 100).toFixed(1)}%`
                            : rule.ruleType === 'TIER_PRICING'
                            ? 'Tiered'
                            : '-'}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className="font-mono">
                            {rule.priority}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant={rule.isActive ? 'default' : 'secondary'}>
                            {rule.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Can resource="pricing" action="update">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditRule(list.id, rule)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteRule(list.id, rule.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </Can>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4 border rounded-lg">
                No rules defined
              </div>
            )}
          </Card>
        ))
      )}

      {/* Pricing List Modal */}
      <Modal
        isOpen={showListModal}
        onClose={() => setShowListModal(false)}
        title={editingList ? 'Edit Pricing List' : 'New Pricing List'}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={listFormData.name}
              onChange={(e) => setListFormData({ ...listFormData, name: e.target.value })}
              placeholder="Standard Pricing"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="effectiveFrom">Effective From *</Label>
              <Input
                id="effectiveFrom"
                type="date"
                value={listFormData.effectiveFrom}
                onChange={(e) => setListFormData({ ...listFormData, effectiveFrom: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="effectiveTo">Effective To</Label>
              <Input
                id="effectiveTo"
                type="date"
                value={listFormData.effectiveTo}
                onChange={(e) => setListFormData({ ...listFormData, effectiveTo: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              type="number"
              value={listFormData.priority}
              onChange={(e) => setListFormData({ ...listFormData, priority: parseInt(e.target.value) || 0 })}
              className="mt-1"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowListModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitList} disabled={!listFormData.name || isSaving}>
              {isSaving ? 'Saving...' : editingList ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Rule Modal */}
      <Modal
        isOpen={showRuleModal}
        onClose={() => setShowRuleModal(false)}
        title={editingRule ? 'Edit Pricing Rule' : 'New Pricing Rule'}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <Label>Rule Type *</Label>
            <Select
              value={ruleFormData.ruleType}
              onValueChange={(value: 'LIST_DISCOUNT' | 'TIER_PRICING') =>
                setRuleFormData({ ...ruleFormData, ruleType: value })
              }
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RULE_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {RULE_TYPES.find((t) => t.value === ruleFormData.ruleType)?.description}
            </p>
          </div>

          {ruleFormData.ruleType === 'LIST_DISCOUNT' && (
            <div>
              <Label htmlFor="discountRate">Discount Rate (%) *</Label>
              <Input
                id="discountRate"
                type="number"
                value={ruleFormData.discountRate}
                onChange={(e) => setRuleFormData({ ...ruleFormData, discountRate: e.target.value })}
                placeholder="10"
                min="0"
                max="100"
                step="0.1"
                className="mt-1"
              />
            </div>
          )}

          {ruleFormData.ruleType === 'TIER_PRICING' && (
            <div>
              <Label htmlFor="tierConfig">Tier Configuration (JSON) *</Label>
              <Textarea
                id="tierConfig"
                value={ruleFormData.tierConfig}
                onChange={(e) => setRuleFormData({ ...ruleFormData, tierConfig: e.target.value })}
                rows={8}
                className="mt-1 font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Define tiers with minAmount, maxAmount (null for unlimited), and discountPercent
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="rulePriority">Priority</Label>
            <Input
              id="rulePriority"
              type="number"
              value={ruleFormData.priority}
              onChange={(e) => setRuleFormData({ ...ruleFormData, priority: parseInt(e.target.value) || 0 })}
              className="mt-1"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowRuleModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitRule} disabled={isSaving}>
              {isSaving ? 'Saving...' : editingRule ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
