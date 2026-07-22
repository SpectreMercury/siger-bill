'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Pencil, Plus } from 'lucide-react';
import { api } from '@/lib/client/api';
import { Alert } from '@/components/ui';
import { Can } from '@/components/auth';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';

type PriceBasis = 'STANDARD' | 'COST';

interface CustomerPricingList {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  priceBasis: PriceBasis;
  isActive: boolean;
  ruleCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CustomerPricingTabProps {
  customerId: string;
}

const BASIS_COPY: Record<PriceBasis, { label: string; description: string }> = {
  STANDARD: {
    label: '标准版（列表价）',
    description: '以 BigQuery cost_at_list 为计算基数；客户 Credits 中启用的抵扣类型仍会计入账单。',
  },
  COST: {
    label: 'Cost 版（经销商成本）',
    description: '以 BigQuery cost 为计算基数；客户 Credits 中启用的抵扣类型同样会计入账单。',
  },
};

export function CustomerPricingTab({ customerId }: CustomerPricingTabProps) {
  const router = useRouter();
  const [pricingLists, setPricingLists] = useState<CustomerPricingList[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingList, setEditingList] = useState<CustomerPricingList | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    priceBasis: 'STANDARD' as PriceBasis,
    defaultDiscountPercent: '0',
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<{ data: CustomerPricingList[] }>(
        `/customers/${customerId}/pricing-lists`
      );
      setPricingLists(response.data || []);
    } catch (err) {
      console.error('Error fetching pricing lists:', err);
      setError('定价列表加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditingList(null);
    setFormData({
      name: '',
      status: 'ACTIVE',
      priceBasis: 'STANDARD',
      defaultDiscountPercent: '0',
    });
    setShowModal(true);
  };

  const openEdit = (list: CustomerPricingList) => {
    setEditingList(list);
    setFormData({
      name: list.name,
      status: list.status,
      priceBasis: list.priceBasis,
      defaultDiscountPercent: '0',
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    setError(null);
    try {
      if (editingList) {
        await api.put(`/pricing-lists/${editingList.id}`, {
          name: formData.name,
          status: formData.status,
          priceBasis: formData.priceBasis,
        });
      } else {
        await api.post(`/customers/${customerId}/pricing-lists`, {
          name: formData.name,
          status: formData.status,
          priceBasis: formData.priceBasis,
          defaultDiscountPercent: Number(formData.defaultDiscountPercent),
        });
      }
      setShowModal(false);
      await fetchData();
    } catch (err) {
      console.error('Error saving pricing list:', err);
      setError(err instanceof Error ? err.message : '定价列表保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">客户定价</h3>
          <p className="text-sm text-muted-foreground mt-1">
            账单版本同时决定计算基数和导出版式；Credits 独立配置，标准版和 Cost 版都可抵扣。
          </p>
        </div>
        <Can resource="pricing" action="write">
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            添加定价列表
          </Button>
        </Can>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Card className="p-6 text-center text-muted-foreground">加载中...</Card>
      ) : pricingLists.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">该客户暂无定价列表</Card>
      ) : (
        <div className="space-y-4">
          {pricingLists.map((list) => (
            <Card key={list.id} className="p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold">{list.name}</h4>
                    <Badge variant={list.isActive ? 'default' : 'secondary'}>
                      {list.isActive ? '启用' : '停用'}
                    </Badge>
                    <Badge variant="outline">{BASIS_COPY[list.priceBasis].label}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {BASIS_COPY[list.priceBasis].description}
                  </p>
                  <p className="text-xs text-muted-foreground">{list.ruleCount} 条定价规则</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/admin/pricing-lists/${list.id}`)}
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    管理规则
                  </Button>
                  <Can resource="customers" action="update">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(list)}>
                      <Pencil className="h-4 w-4 mr-1" />
                      编辑
                    </Button>
                  </Can>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingList ? '编辑定价列表' : '新建定价列表'}
        size="md"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="pricing-name">名称 *</Label>
            <Input
              id="pricing-name"
              value={formData.name}
              onChange={(event) => setFormData({ ...formData, name: event.target.value })}
              placeholder="例如：标准账单"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pricing-basis">账单版本 *</Label>
            <Select
              value={formData.priceBasis}
              onValueChange={(value: PriceBasis) => setFormData({ ...formData, priceBasis: value })}
            >
              <SelectTrigger id="pricing-basis">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STANDARD">{BASIS_COPY.STANDARD.label}</SelectItem>
                <SelectItem value="COST">{BASIS_COPY.COST.label}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {BASIS_COPY[formData.priceBasis].description}
            </p>
          </div>

          {!editingList && (
            <div className="space-y-2">
              <Label htmlFor="default-discount">默认折扣（%） *</Label>
              <Input
                id="default-discount"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={formData.defaultDiscountPercent}
                onChange={(event) => setFormData({ ...formData, defaultDiscountPercent: event.target.value })}
                required
              />
              <p className="text-xs text-muted-foreground">0 表示客户支付所选账单基数的 100%。</p>
            </div>
          )}

          {editingList && (
            <div className="space-y-2">
              <Label htmlFor="pricing-status">状态</Label>
              <Select
                value={formData.status}
                onValueChange={(value: 'ACTIVE' | 'INACTIVE') => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger id="pricing-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">启用</SelectItem>
                  <SelectItem value="INACTIVE">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isSaving || !formData.name}>
              {isSaving ? '保存中...' : '保存'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
