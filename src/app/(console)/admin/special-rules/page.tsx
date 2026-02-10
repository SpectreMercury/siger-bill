'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { SpecialRule, Customer, PaginatedResponse } from '@/lib/client/types';
import { DataTable, Button, Alert } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Can } from '@/components/auth';

interface SpecialRuleFormData {
  customerId: string;
  name: string;
  ruleType: string;
  config: string;
  effectiveFrom: string;
  effectiveTo: string;
  priority: number;
}

const RULE_TYPES = [
  { value: 'FLAT_DISCOUNT', label: 'Flat Discount', description: 'Fixed percentage discount on all charges' },
  { value: 'TIERED_DISCOUNT', label: 'Tiered Discount', description: 'Volume-based discount tiers' },
  { value: 'SKU_OVERRIDE', label: 'SKU Override', description: 'Override pricing for specific SKUs' },
  { value: 'MINIMUM_CHARGE', label: 'Minimum Charge', description: 'Minimum monthly charge' },
  { value: 'CAP', label: 'Cap', description: 'Maximum monthly charge' },
];

export default function SpecialRulesPage() {
  const [rules, setRules] = useState<SpecialRule[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<SpecialRule | null>(null);
  const [formData, setFormData] = useState<SpecialRuleFormData>({
    customerId: '',
    name: '',
    ruleType: 'FLAT_DISCOUNT',
    config: '{}',
    effectiveFrom: '',
    effectiveTo: '',
    priority: 0,
  });
  const [isSaving, setIsSaving] = useState(false);

  const fetchRules = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [rulesRes, customersRes] = await Promise.all([
        api.get<PaginatedResponse<SpecialRule>>('/special-rules'),
        api.get<PaginatedResponse<Customer>>('/customers'),
      ]);
      setRules(rulesRes.data || []);
      setCustomers(customersRes.data || []);
    } catch (err) {
      console.error('Error fetching special rules:', err);
      setError('Failed to load special rules');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const getCustomerName = (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    return customer?.name || customerId;
  };

  const columns: ColumnDef<SpecialRule>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: 'customerId',
        header: 'Customer',
        cell: ({ row }) => getCustomerName(row.original.customerId),
      },
      {
        accessorKey: 'ruleType',
        header: 'Type',
        cell: ({ row }) => (
          <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
            {row.original.ruleType.replace(/_/g, ' ')}
          </Badge>
        ),
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
        accessorKey: 'effectiveFrom',
        header: 'Effective From',
        cell: ({ row }) => new Date(row.original.effectiveFrom).toLocaleDateString(),
      },
      {
        accessorKey: 'effectiveTo',
        header: 'Effective To',
        cell: ({ row }) =>
          row.original.effectiveTo
            ? new Date(row.original.effectiveTo).toLocaleDateString()
            : 'No end date',
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
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Can resource="special_rules" action="update">
              <Button variant="ghost" size="sm" onClick={() => handleEdit(row.original)}>
                Edit
              </Button>
            </Can>
          </div>
        ),
      },
    ],
    [customers]
  );

  const handleEdit = (rule: SpecialRule) => {
    setEditingRule(rule);
    setFormData({
      customerId: rule.customerId,
      name: rule.name,
      ruleType: rule.ruleType,
      config: JSON.stringify(rule.config, null, 2),
      effectiveFrom: rule.effectiveFrom.split('T')[0],
      effectiveTo: rule.effectiveTo ? rule.effectiveTo.split('T')[0] : '',
      priority: rule.priority,
    });
    setShowModal(true);
  };

  const handleCreate = () => {
    setEditingRule(null);
    setFormData({
      customerId: '',
      name: '',
      ruleType: 'FLAT_DISCOUNT',
      config: '{\n  "discountPercent": 10\n}',
      effectiveFrom: new Date().toISOString().split('T')[0],
      effectiveTo: '',
      priority: 0,
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      let config;
      try {
        config = JSON.parse(formData.config);
      } catch {
        setError('Invalid JSON configuration');
        setIsSaving(false);
        return;
      }

      const payload = {
        customerId: formData.customerId,
        name: formData.name,
        ruleType: formData.ruleType,
        config,
        effectiveFrom: formData.effectiveFrom,
        effectiveTo: formData.effectiveTo || null,
        priority: formData.priority,
      };

      if (editingRule) {
        await api.put(`/special-rules/${editingRule.id}`, payload);
      } else {
        await api.post('/special-rules', payload);
      }
      setShowModal(false);
      fetchRules();
    } catch (err) {
      console.error('Error saving special rule:', err);
      setError('Failed to save special rule');
    } finally {
      setIsSaving(false);
    }
  };

  const getConfigTemplate = (ruleType: string): string => {
    switch (ruleType) {
      case 'FLAT_DISCOUNT':
        return '{\n  "discountPercent": 10\n}';
      case 'TIERED_DISCOUNT':
        return '{\n  "tiers": [\n    { "minAmount": 0, "maxAmount": 1000, "discountPercent": 5 },\n    { "minAmount": 1000, "maxAmount": 5000, "discountPercent": 10 },\n    { "minAmount": 5000, "maxAmount": null, "discountPercent": 15 }\n  ]\n}';
      case 'SKU_OVERRIDE':
        return '{\n  "skuPatterns": ["compute-*"],\n  "priceOverride": 0.05,\n  "unit": "per-hour"\n}';
      case 'MINIMUM_CHARGE':
        return '{\n  "minimumAmount": 500\n}';
      case 'CAP':
        return '{\n  "maxAmount": 10000\n}';
      default:
        return '{}';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Special Rules</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage customer-specific pricing rules and discounts</p>
        </div>
        <Can resource="special_rules" action="create">
          <Button onClick={handleCreate}>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Rule
          </Button>
        </Can>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card>
        <DataTable
          data={rules}
          columns={columns}
          isLoading={isLoading}
          searchable
          searchPlaceholder="Search rules..."
          emptyMessage="No special rules found"
          pageSize={20}
        />
      </Card>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingRule ? 'Edit Special Rule' : 'New Special Rule'}
        size="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="Enterprise Discount"
                className="mt-1"
              />
            </div>

            <div>
              <Label>Customer *</Label>
              <Select
                value={formData.customerId}
                onValueChange={(value) => setFormData({ ...formData, customerId: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Rule Type *</Label>
              <Select
                value={formData.ruleType}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    ruleType: value,
                    config: getConfigTemplate(value),
                  })
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
                {RULE_TYPES.find((t) => t.value === formData.ruleType)?.description}
              </p>
            </div>

            <div>
              <Label htmlFor="priority">Priority</Label>
              <Input
                id="priority"
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                min={0}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">Higher priority rules are applied first</p>
            </div>
          </div>

          <div>
            <Label htmlFor="config">Configuration (JSON) *</Label>
            <Textarea
              id="config"
              value={formData.config}
              onChange={(e) => setFormData({ ...formData, config: e.target.value })}
              required
              rows={6}
              className="mt-1 font-mono text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="effectiveFrom">Effective From *</Label>
              <Input
                id="effectiveFrom"
                type="date"
                value={formData.effectiveFrom}
                onChange={(e) => setFormData({ ...formData, effectiveFrom: e.target.value })}
                required
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="effectiveTo">Effective To</Label>
              <Input
                id="effectiveTo"
                type="date"
                value={formData.effectiveTo}
                onChange={(e) => setFormData({ ...formData, effectiveTo: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSaving}>
              {editingRule ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
