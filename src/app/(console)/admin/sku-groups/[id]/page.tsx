'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { DataTable, Button, Alert } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Can } from '@/components/auth';
import { ArrowLeft, Plus, Trash2, Search } from 'lucide-react';

interface SkuGroup {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

interface SkuMapping {
  mappingId: string;
  sku: {
    id: string;
    skuId: string;
    skuDescription: string;
    serviceId: string;
    serviceDescription: string;
    unit: string | null;
  };
  createdAt: string;
}

interface SkuSearchResult {
  id: string;
  skuId: string;
  skuDescription: string;
  serviceId: string;
  serviceDescription: string;
  unit: string | null;
  skuGroups: { id: string; code: string; name: string }[];
}

export default function SkuGroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const t = useTranslations('productGroups');
  const tc = useTranslations('common');

  const [skuGroup, setSkuGroup] = useState<SkuGroup | null>(null);
  const [mappings, setMappings] = useState<SkuMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add SKU modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SkuSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  // Remove SKU state
  const [skuToRemove, setSkuToRemove] = useState<SkuMapping | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const fetchGroupAndMappings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<{
        skuGroup: SkuGroup;
        data: SkuMapping[];
        pagination: { total: number };
      }>(`/sku-groups/${id}/mappings?limit=1000`);

      setSkuGroup(response.skuGroup);
      setMappings(response.data || []);
    } catch (err) {
      console.error('Error fetching SKU group:', err);
      setError('Failed to load SKU group');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchGroupAndMappings();
  }, [fetchGroupAndMappings]);

  // Search SKUs
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const response = await api.get<{ data: SkuSearchResult[] }>(
        `/skus?search=${encodeURIComponent(searchQuery)}&limit=50`
      );
      setSearchResults(response.data || []);
    } catch (err) {
      console.error('Error searching SKUs:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Add selected SKUs to group
  const handleAddSkus = async () => {
    if (selectedSkus.length === 0) return;

    setIsAdding(true);
    try {
      await api.post(`/sku-groups/${id}/mappings`, { skuIds: selectedSkus });
      setShowAddModal(false);
      setSelectedSkus([]);
      setSearchResults([]);
      setSearchQuery('');
      fetchGroupAndMappings();
    } catch (err) {
      console.error('Error adding SKUs:', err);
      setError('Failed to add SKUs to group');
    } finally {
      setIsAdding(false);
    }
  };

  // Remove SKU from group
  const handleRemoveSku = async () => {
    if (!skuToRemove) return;

    setIsRemoving(true);
    try {
      await api.delete(`/sku-groups/${id}/mappings`, { skuIds: [skuToRemove.sku.skuId] });
      setSkuToRemove(null);
      fetchGroupAndMappings();
    } catch (err) {
      console.error('Error removing SKU:', err);
      setError('Failed to remove SKU from group');
    } finally {
      setIsRemoving(false);
    }
  };

  // Toggle SKU selection
  const toggleSkuSelection = (skuId: string) => {
    setSelectedSkus((prev) =>
      prev.includes(skuId)
        ? prev.filter((id) => id !== skuId)
        : [...prev, skuId]
    );
  };

  // Check if SKU is already in this group
  const isSkuInGroup = (skuId: string) => {
    return mappings.some((m) => m.sku.skuId === skuId);
  };

  const columns: ColumnDef<SkuMapping>[] = useMemo(
    () => [
      {
        accessorKey: 'sku.skuId',
        header: t('table.itemId'),
        cell: ({ row }) => (
          <code className="text-xs bg-muted px-2 py-1 rounded">
            {row.original.sku.skuId}
          </code>
        ),
      },
      {
        accessorKey: 'sku.skuDescription',
        header: t('table.itemName'),
        cell: ({ row }) => (
          <span className="text-sm">{row.original.sku.skuDescription}</span>
        ),
      },
      {
        accessorKey: 'sku.serviceDescription',
        header: t('table.cloudService'),
        cell: ({ row }) => (
          <Badge variant="secondary">{row.original.sku.serviceDescription}</Badge>
        ),
      },
      {
        accessorKey: 'sku.unit',
        header: t('table.unit'),
        cell: ({ row }) => row.original.sku.unit || '-',
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Can resource="sku_groups" action="write">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSkuToRemove(row.original)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </Can>
        ),
      },
    ],
    [t]
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-muted rounded w-48 animate-pulse" />
        <div className="h-64 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!skuGroup) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">{t('loadFailed')}</p>
        <Link href="/admin/sku-groups">
          <Button variant="secondary" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {tc('back')}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin/sku-groups">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {tc('back')}
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{skuGroup.name}</h1>
            <Badge variant="secondary" className="font-mono">
              {skuGroup.code}
            </Badge>
          </div>
          {skuGroup.description && (
            <p className="text-muted-foreground text-sm mt-1">{skuGroup.description}</p>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Billing Items Card */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold">{t('detail.billingItemsTitle')}</h3>
            <p className="text-sm text-muted-foreground">
              {mappings.length === 0
                ? t('detail.noItemsYet')
                : `${mappings.length} ${t('billingItems').toLowerCase()}`}
            </p>
          </div>
          <Can resource="sku_groups" action="write">
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('actions.addItems')}
            </Button>
          </Can>
        </div>

        <DataTable
          data={mappings}
          columns={columns}
          isLoading={isLoading}
          searchable
          searchPlaceholder={t('search.placeholder')}
          emptyMessage={t('detail.noItemsYet')}
          pageSize={20}
          className="-mx-6 -mb-6"
        />
      </Card>

      {/* Add Items Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setSearchQuery('');
          setSearchResults([]);
          setSelectedSkus([]);
        }}
        title={t('modal.addItemsTitle')}
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('modal.addItemsDescription')}
          </p>

          {/* Search */}
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="search" className="sr-only">{t('search.placeholder')}</Label>
              <Input
                id="search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={t('search.searchHint')}
              />
            </div>
            <Button onClick={handleSearch} disabled={isSearching}>
              <Search className="h-4 w-4 mr-2" />
              {isSearching ? tc('loading') : tc('search')}
            </Button>
          </div>

          {/* Selected count */}
          {selectedSkus.length > 0 && (
            <div className="text-sm text-muted-foreground">
              {selectedSkus.length} {t('billingItems').toLowerCase()}
            </div>
          )}

          {/* Search Results */}
          {searchResults.length > 0 ? (
            <div className="border rounded-lg max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="w-10 px-4 py-2"></th>
                    <th className="px-4 py-2 text-left font-medium">{t('table.itemId')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('table.itemName')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('table.cloudService')}</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((sku) => {
                    const inGroup = isSkuInGroup(sku.skuId);
                    const isSelected = selectedSkus.includes(sku.skuId);
                    return (
                      <tr
                        key={sku.id}
                        className={`border-t cursor-pointer hover:bg-muted/50 ${
                          inGroup ? 'opacity-50' : ''
                        } ${isSelected ? 'bg-primary/10' : ''}`}
                        onClick={() => !inGroup && toggleSkuSelection(sku.skuId)}
                      >
                        <td className="px-4 py-2">
                          {inGroup ? (
                            <Badge variant="secondary" className="text-xs">
                              {tc('add')}
                            </Badge>
                          ) : (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSkuSelection(sku.skuId)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <code className="text-xs bg-muted px-1 py-0.5 rounded">
                            {sku.skuId.length > 30
                              ? `${sku.skuId.slice(0, 30)}...`
                              : sku.skuId}
                          </code>
                        </td>
                        <td className="px-4 py-2">{sku.skuDescription}</td>
                        <td className="px-4 py-2">
                          <Badge variant="secondary">{sku.serviceDescription}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : searchQuery && !isSearching ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>{t('search.noResults')}</p>
              <p className="text-xs mt-2">{t('search.noResultsHint')}</p>
            </div>
          ) : !searchQuery ? (
            <div className="text-center py-8 text-muted-foreground border rounded-lg">
              <p>{t('search.enterTerm')}</p>
              <p className="text-xs mt-2">{t('search.searchHint')}</p>
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowAddModal(false);
                setSearchQuery('');
                setSearchResults([]);
                setSelectedSkus([]);
              }}
            >
              {tc('cancel')}
            </Button>
            <Button
              onClick={handleAddSkus}
              disabled={selectedSkus.length === 0 || isAdding}
            >
              {isAdding ? t('adding') : `${tc('add')} ${selectedSkus.length} ${t('itemsUnit')}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Remove Item Confirmation */}
      <Modal
        isOpen={!!skuToRemove}
        onClose={() => setSkuToRemove(null)}
        title={t('modal.removeItemTitle')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            {t('modal.removeItemConfirm')}
          </p>
          {skuToRemove && (
            <div className="bg-muted/50 p-3 rounded-lg">
              <p className="font-medium">{skuToRemove.sku.skuDescription}</p>
              <code className="text-xs text-muted-foreground">
                {skuToRemove.sku.skuId}
              </code>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setSkuToRemove(null)}>
              {tc('cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={handleRemoveSku}
              disabled={isRemoving}
            >
              {isRemoving ? tc('loading') : tc('remove')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
