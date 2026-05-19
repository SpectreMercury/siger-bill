'use client';

/**
 * ManageProjectsDrawer
 *
 * Used from the customer list page and the customer detail tab to manage
 * project bindings in bulk. Opens a Modal (the project's existing Dialog
 * wrapper — no shadcn Sheet is installed) with two regions:
 *
 *   1. Typeahead search (debounced) against /api/projects?search=
 *   2. Selected list (chips with X to remove); staged changes only commit
 *      on "Save changes" via PUT /api/customers/[id]/projects.
 *
 * The server side does the diff atomically (createMany + deleteMany in one
 * $transaction), so this component just sends the desired set.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/client/api';
import { PaginatedResponse, Project } from '@/lib/client/types';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import { Alert } from '@/components/ui';
import { Loader2, Search, X, Check } from 'lucide-react';

interface CustomerBinding {
  id: string;
  projectId: string;
  projectName: string | null;
  billable: boolean;
}

interface ManageProjectsDrawerProps {
  customerId: string | null;
  customerName: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ManageProjectsDrawer({
  customerId,
  customerName,
  open,
  onClose,
  onSaved,
}: ManageProjectsDrawerProps) {
  const t = useTranslations('customers.modal');
  const tc = useTranslations('common');

  const [initialIds, setInitialIds] = useState<Set<string>>(new Set());
  const [stagedIds, setStagedIds] = useState<Set<string>>(new Set());
  const [stagedMeta, setStagedMeta] = useState<Map<string, { name: string | null; billable: boolean }>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Typeahead state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Project[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load current bindings when drawer opens
  const loadBindings = useCallback(async () => {
    if (!customerId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<PaginatedResponse<CustomerBinding>>(
        `/customers/${customerId}/projects?limit=200`
      );
      const rows = res.data ?? [];
      const ids = new Set(rows.map((r) => r.projectId));
      const meta = new Map(
        rows.map((r) => [r.projectId, { name: r.projectName, billable: r.billable }])
      );
      setInitialIds(ids);
      setStagedIds(new Set(ids));
      setStagedMeta(meta);
    } catch (err) {
      console.error('Failed to load bindings', err);
      setError(t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [customerId, t]);

  useEffect(() => {
    if (open && customerId) {
      loadBindings();
      setSearchTerm('');
      setSearchResults([]);
    }
  }, [open, customerId, loadBindings]);

  // Debounced typeahead search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = searchTerm.trim();
    if (term.length === 0) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await api.get<PaginatedResponse<Project>>(
          `/projects?search=${encodeURIComponent(term)}&limit=20`
        );
        setSearchResults(res.data ?? []);
      } catch (err) {
        console.error('Search failed', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchTerm]);

  // Diff for the dirty indicator + save action
  const { toAdd, toRemove, hasChanges } = useMemo(() => {
    const add = Array.from(stagedIds).filter((id) => !initialIds.has(id));
    const remove = Array.from(initialIds).filter((id) => !stagedIds.has(id));
    return { toAdd: add, toRemove: remove, hasChanges: add.length > 0 || remove.length > 0 };
  }, [initialIds, stagedIds]);

  const addProject = (project: Project) => {
    setStagedIds((prev) => {
      if (prev.has(project.projectId)) return prev;
      const next = new Set(prev);
      next.add(project.projectId);
      return next;
    });
    setStagedMeta((prev) => {
      const next = new Map(prev);
      if (!next.has(project.projectId)) {
        next.set(project.projectId, { name: project.name, billable: true });
      }
      return next;
    });
  };

  const removeProject = (projectId: string) => {
    setStagedIds((prev) => {
      const next = new Set(prev);
      next.delete(projectId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!customerId || !hasChanges) return;
    setIsSaving(true);
    setError(null);
    try {
      await api.put(`/customers/${customerId}/projects`, {
        projectIds: Array.from(stagedIds),
      });
      onSaved();
      onClose();
    } catch (err) {
      console.error('Save failed', err);
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const stagedList = useMemo(() => {
    return Array.from(stagedIds).map((id) => {
      const meta = stagedMeta.get(id);
      return {
        projectId: id,
        name: meta?.name ?? null,
        billable: meta?.billable ?? true,
      };
    });
  }, [stagedIds, stagedMeta]);

  if (!customerId) return null;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={t('title', { name: customerName })}
      size="lg"
    >
      <div className="space-y-4">
        {error && (
          <Alert variant="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Search */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="pl-9"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-md border bg-background">
              {searchResults.map((p) => {
                const selected = stagedIds.has(p.projectId);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => (selected ? removeProject(p.projectId) : addProject(p))}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted ${
                      selected ? 'bg-muted/60' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-xs text-muted-foreground truncate">
                        {p.projectId}
                      </div>
                      {p.name && (
                        <div className="text-sm truncate">{p.name}</div>
                      )}
                    </div>
                    {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}

          {searchTerm.trim().length > 0 && !isSearching && searchResults.length === 0 && (
            <p className="text-xs text-muted-foreground px-1">{t('noResults')}</p>
          )}
        </div>

        {/* Selected */}
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {t('selected', { count: stagedIds.size })}
            </span>
            {hasChanges && (
              <span className="text-xs text-muted-foreground">
                {toAdd.length > 0 && `+${toAdd.length}`}
                {toAdd.length > 0 && toRemove.length > 0 && '  '}
                {toRemove.length > 0 && `−${toRemove.length}`}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm">{tc('loading')}</span>
            </div>
          ) : stagedList.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {t('empty')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto">
              {stagedList.map((item) => (
                <Badge
                  key={item.projectId}
                  variant="outline"
                  className="pl-2 pr-1 py-1 gap-1.5 max-w-[260px]"
                >
                  <span className="font-mono text-xs truncate">{item.projectId}</span>
                  {item.name && (
                    <span className="text-xs text-muted-foreground truncate">· {item.name}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeProject(item.projectId)}
                    className="ml-1 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                    aria-label={`remove ${item.projectId}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-2 border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
            {tc('cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={!hasChanges || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {tc('saving')}
              </>
            ) : (
              t('saveChanges')
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
