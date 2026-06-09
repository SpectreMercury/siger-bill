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
import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/client/api';
import { PaginatedResponse } from '@/lib/client/types';
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

interface ProjectBindingCandidate {
  id: string;
  projectId: string;
  name: string | null;
  billable: boolean;
  billingAccount: {
    id: string;
    billingAccountId: string;
    name: string | null;
  } | null;
  boundCustomers: Array<{
    customerId: string;
    customerName: string;
    startDate: string | null;
    endDate: string | null;
  }>;
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
  const [searchResults, setSearchResults] = useState<ProjectBindingCandidate[]>([]);
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

  // Picker is a transient floating overlay: hidden by default, opens when the
  // user clicks/focuses the search input, closes on Esc / outside click.
  // Modal stays compact when closed.
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close picker on Escape key. (Outside-click is intentionally NOT bound:
  // the picker is now an inline body region, not a floating popover, so the
  // user closes it explicitly via the X button on the search input.)
  useEffect(() => {
    if (!pickerOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickerOpen(false);
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (open && customerId) {
      loadBindings();
      setSearchTerm('');
      setSearchResults([]);
      setPickerOpen(false);
    }
  }, [open, customerId, loadBindings]);

  // Fetch projects only after picker is opened. Re-runs when search term
  // changes; empty term loads default top 50.
  useEffect(() => {
    if (!open || !pickerOpen) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = searchTerm.trim();
    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const url = term.length === 0
          ? `/project-billing-configs?limit=50`
          : `/project-billing-configs?search=${encodeURIComponent(term)}&limit=50`;
        const res = await api.get<PaginatedResponse<ProjectBindingCandidate>>(url);
        setSearchResults(res.data ?? []);
      } catch (err) {
        console.error('Search failed', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [open, pickerOpen, searchTerm]);

  // Diff for the dirty indicator + save action
  const { toAdd, toRemove, hasChanges } = useMemo(() => {
    const add = Array.from(stagedIds).filter((id) => !initialIds.has(id));
    const remove = Array.from(initialIds).filter((id) => !stagedIds.has(id));
    return { toAdd: add, toRemove: remove, hasChanges: add.length > 0 || remove.length > 0 };
  }, [initialIds, stagedIds]);

  const addProject = (project: ProjectBindingCandidate) => {
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
      size="xl"
    >
      {/* Tall fixed-height column. Main body region swaps between two states:
          - picker closed → "Selected" panel (chips list) takes the body
          - picker open  → candidate list takes the body
          Modal height stays the same either way. */}
      <div className="flex flex-col h-[75vh] -mt-2">
        {error && (
          <Alert variant="error" onClose={() => setError(null)} className="mb-3">
            {error}
          </Alert>
        )}

        {/* Search */}
        <div className="shrink-0 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchInputRef as RefObject<HTMLInputElement>}
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPickerOpen(true); }}
            onFocus={() => setPickerOpen(true)}
            onClick={() => setPickerOpen(true)}
            placeholder={t('searchPlaceholder')}
            className="pl-9 pr-9"
          />
          {pickerOpen ? (
            <button
              type="button"
              onClick={() => { setPickerOpen(false); setSearchTerm(''); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
              aria-label="close picker"
              title="Esc"
            >
              <X className="h-4 w-4" />
            </button>
          ) : isSearching ? (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        {/* Body — fills remaining height. Toggles between picker and selected panel. */}
        <div
          ref={pickerContainerRef}
          className="mt-3 flex-1 min-h-0 overflow-hidden rounded-md border bg-popover/30"
        >
          {pickerOpen ? (
            isSearching && searchResults.length === 0 ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm">{tc('loading')}</span>
              </div>
            ) : searchResults.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {searchTerm.trim().length > 0 ? t('noResults') : t('empty')}
              </p>
            ) : (
              <ul role="listbox" aria-multiselectable="true" className="h-full overflow-y-auto py-1">
                {searchResults.map((p) => {
                  const selected = stagedIds.has(p.projectId);
                  const boundElsewhere = (p.boundCustomers ?? []).some(
                    (bc) => bc.customerId !== customerId
                  );
                  const elsewhereName = (p.boundCustomers ?? [])
                    .filter((bc) => bc.customerId !== customerId)
                    .map((bc) => bc.customerName)[0];
                  const disabled = boundElsewhere && !selected;

                  return (
                    <li key={p.id} role="option" aria-selected={selected}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => (selected ? removeProject(p.projectId) : addProject(p))}
                        className={`group flex w-full items-start gap-3 px-3 py-2 text-left transition-colors
                          ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-accent/60 cursor-pointer'}
                          ${selected ? 'bg-accent/40' : ''}
                        `}
                        title={
                          disabled
                            ? `${t('boundToOther')}${elsewhereName ? `: ${elsewhereName}` : ''}`
                            : selected
                            ? t('alreadySelected')
                            : undefined
                        }
                      >
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-colors
                            ${selected
                              ? 'bg-primary border-primary'
                              : 'border-input bg-background group-hover:border-foreground/40'}
                          `}
                          aria-hidden="true"
                        >
                          {selected && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
                        </span>
                        <div className="min-w-0 flex-1 leading-tight">
                          <div className="text-sm truncate">
                            {p.name || (
                              <span className="text-muted-foreground italic">
                                {t('unnamedProject')}
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground truncate">
                            {p.projectId}
                          </div>
                        </div>
                        {(selected || boundElsewhere) && (
                          <span className="ml-auto shrink-0 self-center inline-flex items-center rounded-full border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                            {selected
                              ? t('selfBoundTag')
                              : elsewhereName
                              ? `${t('otherBoundTag')} ${elsewhereName}`
                              : t('otherBoundTag')}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            /* Selected panel — fills the body when picker is closed */
            <div className="flex h-full flex-col">
              <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b text-sm">
                <span className="font-medium">
                  {t('selected', { count: stagedIds.size })}
                </span>
                {hasChanges && (
                  <span className="text-xs text-muted-foreground">
                    {toAdd.length > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{toAdd.length}</span>}
                    {toAdd.length > 0 && toRemove.length > 0 && ' · '}
                    {toRemove.length > 0 && <span className="text-rose-600 dark:text-rose-400">−{toRemove.length}</span>}
                  </span>
                )}
              </div>
              {isLoading ? (
                <div className="flex flex-1 items-center justify-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm">{tc('loading')}</span>
                </div>
              ) : stagedList.length === 0 ? (
                <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground px-4 text-center">
                  {t('empty')}
                </p>
              ) : (
                <div className="flex-1 overflow-y-auto p-3 flex flex-wrap gap-2 content-start">
                  {stagedList.map((item) => (
                    <Badge
                      key={item.projectId}
                      variant="outline"
                      className="pl-2 pr-1 py-1 gap-1.5 max-w-[280px] self-start"
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
          )}
        </div>

        {/* Footer — also shows the live selected count / diff so user has
            constant feedback while picking. */}
        <div className="shrink-0 flex items-center justify-between gap-3 pt-3 mt-3 border-t">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {t('selected', { count: stagedIds.size })}
            </span>
            {hasChanges && (
              <span className="ml-2">
                {toAdd.length > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{toAdd.length}</span>}
                {toAdd.length > 0 && toRemove.length > 0 && ' · '}
                {toRemove.length > 0 && <span className="text-rose-600 dark:text-rose-400">−{toRemove.length}</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
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
      </div>
    </Modal>
  );
}
