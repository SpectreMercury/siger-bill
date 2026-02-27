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
import { ArrowLeft, Plus, Trash2, Search, Layers } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  resourceFamily: string | null;
  resourceGroup: string | null;
  usageType: string | null;
  skuGroups: { id: string; code: string; name: string }[];
}

// GCP category tree returned by /api/skus/categories
interface UsageTypeNode { usageType: string; skuCount: number }
interface GroupNode     { resourceGroup: string; skuCount: number; usageTypes: UsageTypeNode[] }
interface FamilyNode    { resourceFamily: string; skuCount: number; groups: GroupNode[] }
interface ServiceNode   { serviceId: string; serviceDescription: string; skuCount: number; families: FamilyNode[] }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  // Two tabs: 'browse' | 'search'
  const [addTab, setAddTab] = useState<'browse' | 'search'>('browse');

  // ---- Browse mode state ----
  const [categoryTree, setCategoryTree] = useState<ServiceNode[]>([]);
  const [isCategoryLoading, setIsCategoryLoading] = useState(false);
  const [selectedService, setSelectedService] = useState<string>('');
  const [selectedFamily, setSelectedFamily] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [selectedUsageType, setSelectedUsageType] = useState<string>('');

  // ---- Search mode state ----
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // ---- Shared results ----
  const [searchResults, setSearchResults] = useState<SkuSearchResult[]>([]);
  const [isResultsLoading, setIsResultsLoading] = useState(false);
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);

  // Remove SKU state
  const [skuToRemove, setSkuToRemove] = useState<SkuMapping | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

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

  // Load category tree when modal opens in browse mode
  const loadCategories = useCallback(async () => {
    if (categoryTree.length > 0) return; // already loaded
    setIsCategoryLoading(true);
    try {
      const response = await api.get<{ data: ServiceNode[] }>('/skus/categories');
      setCategoryTree(response.data || []);
    } catch (err) {
      console.error('Error loading categories:', err);
    } finally {
      setIsCategoryLoading(false);
    }
  }, [categoryTree.length]);

  // Load SKUs by browse filters whenever any filter changes
  const loadBrowsedSkus = useCallback(async () => {
    if (!selectedService) {
      setSearchResults([]);
      return;
    }
    setIsResultsLoading(true);
    try {
      const params = new URLSearchParams({ serviceId: selectedService, limit: '100' });
      if (selectedFamily)    params.set('resourceFamily', selectedFamily);
      if (selectedGroup)     params.set('resourceGroup', selectedGroup);
      if (selectedUsageType) params.set('usageType', selectedUsageType);

      const response = await api.get<{ data: SkuSearchResult[] }>(`/skus?${params}`);
      setSearchResults(response.data || []);
    } catch (err) {
      console.error('Error browsing SKUs:', err);
    } finally {
      setIsResultsLoading(false);
    }
  }, [selectedService, selectedFamily, selectedGroup, selectedUsageType]);

  useEffect(() => {
    if (addTab === 'browse') {
      loadBrowsedSkus();
    }
  }, [addTab, loadBrowsedSkus]);

  // ---------------------------------------------------------------------------
  // Derived category options based on current selections
  // ---------------------------------------------------------------------------

  const availableFamilies = useMemo((): FamilyNode[] => {
    if (!selectedService) return [];
    const svc = categoryTree.find((s) => s.serviceId === selectedService);
    return svc?.families ?? [];
  }, [categoryTree, selectedService]);

  const availableGroups = useMemo((): GroupNode[] => {
    if (!selectedFamily) return [];
    const fam = availableFamilies.find((f) => f.resourceFamily === selectedFamily);
    return fam?.groups ?? [];
  }, [availableFamilies, selectedFamily]);

  const availableUsageTypes = useMemo((): UsageTypeNode[] => {
    if (!selectedGroup) return [];
    const grp = availableGroups.find((g) => g.resourceGroup === selectedGroup);
    return grp?.usageTypes ?? [];
  }, [availableGroups, selectedGroup]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleOpenAddModal = () => {
    setShowAddModal(true);
    setAddTab('browse');
    loadCategories();
  };

  const resetAddModal = () => {
    setShowAddModal(false);
    setAddTab('browse');
    setSelectedService('');
    setSelectedFamily('');
    setSelectedGroup('');
    setSelectedUsageType('');
    setSearchQuery('');
    setSearchResults([]);
    setSelectedSkus([]);
  };

  const handleServiceChange = (value: string) => {
    setSelectedService(value);
    setSelectedFamily('');
    setSelectedGroup('');
    setSelectedUsageType('');
  };

  const handleFamilyChange = (value: string) => {
    setSelectedFamily(value);
    setSelectedGroup('');
    setSelectedUsageType('');
  };

  const handleGroupChange = (value: string) => {
    setSelectedGroup(value);
    setSelectedUsageType('');
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setIsResultsLoading(true);
    try {
      const response = await api.get<{ data: SkuSearchResult[] }>(
        `/skus?search=${encodeURIComponent(searchQuery)}&limit=50`
      );
      setSearchResults(response.data || []);
    } catch (err) {
      console.error('Error searching SKUs:', err);
    } finally {
      setIsSearching(false);
      setIsResultsLoading(false);
    }
  };

  const handleAddSkus = async () => {
    if (selectedSkus.length === 0) return;
    setIsAdding(true);
    try {
      await api.post(`/sku-groups/${id}/mappings`, { skuIds: selectedSkus });
      resetAddModal();
      fetchGroupAndMappings();
    } catch (err) {
      console.error('Error adding SKUs:', err);
      setError('Failed to add SKUs to group');
    } finally {
      setIsAdding(false);
    }
  };

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

  const toggleSkuSelection = (skuId: string) => {
    setSelectedSkus((prev) =>
      prev.includes(skuId) ? prev.filter((s) => s !== skuId) : [...prev, skuId]
    );
  };

  const isSkuInGroup = (skuId: string) =>
    mappings.some((m) => m.sku.skuId === skuId);

  // ---------------------------------------------------------------------------
  // Table columns
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderCategoryBreadcrumb = () => {
    const parts: string[] = [];
    if (selectedService) {
      const svc = categoryTree.find((s) => s.serviceId === selectedService);
      if (svc) parts.push(svc.serviceDescription);
    }
    if (selectedFamily) parts.push(selectedFamily);
    if (selectedGroup)  parts.push(selectedGroup);
    if (selectedUsageType) parts.push(selectedUsageType);
    if (parts.length === 0) return null;
    return (
      <div className="flex items-center gap-1 flex-wrap text-xs text-muted-foreground">
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span>/</span>}
            <span className="bg-muted px-1.5 py-0.5 rounded font-medium">{p}</span>
          </span>
        ))}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Loading / not-found states
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

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
            <Button onClick={handleOpenAddModal}>
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

      {/* ================================================================
          Add Items Modal
          ================================================================ */}
      <Modal
        isOpen={showAddModal}
        onClose={resetAddModal}
        title={t('modal.addItemsTitle')}
        size="xl"
      >
        <div className="space-y-4">
          {/* Tab switcher */}
          <div className="flex border-b">
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                addTab === 'browse'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setAddTab('browse')}
            >
              <Layers className="h-3.5 w-3.5 inline mr-1.5" />
              {t('browse.tabLabel')}
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                addTab === 'search'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => {
                setAddTab('search');
                setSearchResults([]);
              }}
            >
              <Search className="h-3.5 w-3.5 inline mr-1.5" />
              {t('browse.searchTabLabel')}
            </button>
          </div>

          {/* ---- Browse Tab ---- */}
          {addTab === 'browse' && (
            <div className="space-y-3">
              {isCategoryLoading ? (
                <p className="text-sm text-muted-foreground">{t('browse.loadingCategories')}</p>
              ) : categoryTree.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('search.noResultsHint')}</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{t('browse.categoryHint')}</p>
                  {/* 4-level cascade filters */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Level 1: Service */}
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        {t('browse.selectService')}
                      </Label>
                      <select
                        className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        value={selectedService}
                        onChange={(e) => handleServiceChange(e.target.value)}
                      >
                        <option value="">{t('browse.allServices')}</option>
                        {categoryTree.map((svc) => (
                          <option key={svc.serviceId} value={svc.serviceId}>
                            {svc.serviceDescription} ({svc.skuCount})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Level 2: Resource Family */}
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        {t('browse.selectFamily')}
                      </Label>
                      <select
                        className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                        value={selectedFamily}
                        onChange={(e) => handleFamilyChange(e.target.value)}
                        disabled={availableFamilies.length === 0}
                      >
                        <option value="">{t('browse.allFamilies')}</option>
                        {availableFamilies.map((f) => (
                          <option key={f.resourceFamily} value={f.resourceFamily}>
                            {f.resourceFamily} ({f.skuCount})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Level 3: Resource Group */}
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        {t('browse.selectGroup')}
                      </Label>
                      <select
                        className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                        value={selectedGroup}
                        onChange={(e) => handleGroupChange(e.target.value)}
                        disabled={availableGroups.length === 0}
                      >
                        <option value="">{t('browse.allGroups')}</option>
                        {availableGroups.map((g) => (
                          <option key={g.resourceGroup} value={g.resourceGroup}>
                            {g.resourceGroup} ({g.skuCount})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Level 4: Usage Type */}
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">
                        {t('browse.selectUsageType')}
                      </Label>
                      <select
                        className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                        value={selectedUsageType}
                        onChange={(e) => setSelectedUsageType(e.target.value)}
                        disabled={availableUsageTypes.length === 0}
                      >
                        <option value="">{t('browse.allUsageTypes')}</option>
                        {availableUsageTypes.map((u) => (
                          <option key={u.usageType} value={u.usageType}>
                            {u.usageType} ({u.skuCount})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Breadcrumb trail */}
                  {renderCategoryBreadcrumb()}
                </>
              )}
            </div>
          )}

          {/* ---- Search Tab ---- */}
          {addTab === 'search' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="sku-search" className="sr-only">
                  {t('search.placeholder')}
                </Label>
                <Input
                  id="sku-search"
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
          )}

          {/* Selected count badge */}
          {selectedSkus.length > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-xs">
                {selectedSkus.length} {t('itemsUnit')} {tc('selected') || '已选'}
              </Badge>
              <button
                className="text-xs text-muted-foreground underline"
                onClick={() => setSelectedSkus([])}
              >
                {tc('clear')}
              </button>
            </div>
          )}

          {/* ---- Results Table ---- */}
          {isResultsLoading ? (
            <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
              {tc('loading')}
            </div>
          ) : searchResults.length > 0 ? (
            <div className="border rounded-lg max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="w-10 px-3 py-2" />
                    <th className="px-3 py-2 text-left font-medium">{t('table.itemId')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('table.itemName')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('table.cloudService')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('table.unit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((sku) => {
                    const inGroup  = isSkuInGroup(sku.skuId);
                    const isSelected = selectedSkus.includes(sku.skuId);
                    return (
                      <tr
                        key={sku.id}
                        className={`border-t transition-colors ${
                          inGroup
                            ? 'opacity-40 cursor-not-allowed'
                            : 'cursor-pointer hover:bg-muted/40'
                        } ${isSelected ? 'bg-primary/5' : ''}`}
                        onClick={() => !inGroup && toggleSkuSelection(sku.skuId)}
                      >
                        <td className="px-3 py-2">
                          {inGroup ? (
                            <Badge variant="secondary" className="text-xs">已添加</Badge>
                          ) : (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSkuSelection(sku.skuId)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 rounded border-gray-300 accent-primary"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {sku.skuId.length > 28 ? `${sku.skuId.slice(0, 28)}…` : sku.skuId}
                          </code>
                        </td>
                        <td className="px-3 py-2">
                          <div>{sku.skuDescription}</div>
                          {(sku.resourceFamily || sku.resourceGroup || sku.usageType) && (
                            <div className="flex gap-1 mt-0.5 flex-wrap">
                              {sku.resourceFamily && (
                                <span className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-1 rounded">
                                  {sku.resourceFamily}
                                </span>
                              )}
                              {sku.resourceGroup && (
                                <span className="text-xs bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 px-1 rounded">
                                  {sku.resourceGroup}
                                </span>
                              )}
                              {sku.usageType && (
                                <span className="text-xs bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-1 rounded">
                                  {sku.usageType}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="secondary" className="text-xs">
                            {sku.serviceDescription}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {sku.unit || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : addTab === 'browse' && !selectedService ? (
            <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
              <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>{t('browse.categoryHint')}</p>
            </div>
          ) : addTab === 'search' && !searchQuery ? (
            <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>{t('search.enterTerm')}</p>
              <p className="text-xs mt-1">{t('search.searchHint')}</p>
            </div>
          ) : (
            <div className="border rounded-lg p-8 text-center text-sm text-muted-foreground">
              <p>{t('browse.noSkusInCategory')}</p>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={resetAddModal}>
              {tc('cancel')}
            </Button>
            <Button
              onClick={handleAddSkus}
              disabled={selectedSkus.length === 0 || isAdding}
            >
              {isAdding
                ? t('adding')
                : `${tc('add')} ${selectedSkus.length > 0 ? selectedSkus.length : ''} ${t('itemsUnit')}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ================================================================
          Remove Item Confirmation
          ================================================================ */}
      <Modal
        isOpen={!!skuToRemove}
        onClose={() => setSkuToRemove(null)}
        title={t('modal.removeItemTitle')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">{t('modal.removeItemConfirm')}</p>
          {skuToRemove && (
            <div className="bg-muted/50 p-3 rounded-lg">
              <p className="font-medium">{skuToRemove.sku.skuDescription}</p>
              <code className="text-xs text-muted-foreground">{skuToRemove.sku.skuId}</code>
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setSkuToRemove(null)}>
              {tc('cancel')}
            </Button>
            <Button variant="danger" onClick={handleRemoveSku} disabled={isRemoving}>
              {isRemoving ? tc('loading') : tc('remove')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
