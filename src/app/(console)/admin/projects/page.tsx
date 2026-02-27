'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { Project, PaginatedResponse } from '@/lib/client/types';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { Modal } from '@/components/ui/Modal';
import { Can } from '@/components/auth';
import {
  Plus,
  Pencil,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  CloudDownload,
  FolderOpen,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GcpProjectInfo {
  name: string;
  projectNumber: string;
  lifecycleState: string;
}

type GcpLookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: GcpProjectInfo }
  | { status: 'error'; message: string };

interface GcpBillingAccount {
  billingAccountId: string;
  displayName: string;
  open: boolean;
}

interface GcpProjectBillingInfo {
  projectId: string;
  billingEnabled: boolean;
  billingAccountId: string;
}

interface ProjectFormData {
  projectId: string;
  projectNumber: string;
  name: string;
  iamRole: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function ProjectsPage() {
  const t = useTranslations('projects');
  const tc = useTranslations('common');

  // ---------- system projects list ----------
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---------- modal state ----------
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [createTab, setCreateTab] = useState<'manual' | 'gcp'>('manual');

  // ---------- form ----------
  const [formData, setFormData] = useState<ProjectFormData>({
    projectId: '',
    projectNumber: '',
    name: '',
    iamRole: '',
    status: 'ACTIVE',
  });
  const [isSaving, setIsSaving] = useState(false);

  // ---------- manual-mode GCP lookup ----------
  const [gcpLookup, setGcpLookup] = useState<GcpLookupState>({ status: 'idle' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- GCP billing account browse ----------
  const [gcpAccounts, setGcpAccounts] = useState<GcpBillingAccount[]>([]);
  const [gcpAccountsLoading, setGcpAccountsLoading] = useState(false);
  const [gcpAccountsError, setGcpAccountsError] = useState<string | null>(null);
  const [selectedGcpAccount, setSelectedGcpAccount] = useState<string>('');
  const [gcpBillingProjects, setGcpBillingProjects] = useState<GcpProjectBillingInfo[]>([]);
  const [gcpProjectsLoading, setGcpProjectsLoading] = useState(false);
  const [gcpProjectsError, setGcpProjectsError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<PaginatedResponse<Project>>('/projects');
      setProjects(response.data || []);
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError('Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // ---------------------------------------------------------------------------
  // GCP lookup (manual create mode)
  // ---------------------------------------------------------------------------

  const lookupGcpProject = useCallback(async (projectId: string) => {
    if (!projectId.trim()) {
      setGcpLookup({ status: 'idle' });
      return;
    }
    setGcpLookup({ status: 'loading' });
    try {
      const res = await api.get<{
        projectId: string;
        name: string;
        projectNumber: string;
        lifecycleState: string;
      }>(`/gcp/project-info?projectId=${encodeURIComponent(projectId)}`);
      setGcpLookup({ status: 'success', data: res });
      setFormData((prev) => ({ ...prev, name: res.name, projectNumber: res.projectNumber }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('gcpLookupFailed');
      setGcpLookup({ status: 'error', message: msg });
      setFormData((prev) => ({ ...prev, name: '', projectNumber: '' }));
    }
  }, [t]);

  const handleProjectIdChange = useCallback(
    (value: string) => {
      setFormData((prev) => ({ ...prev, projectId: value }));
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!value.trim()) {
        setGcpLookup({ status: 'idle' });
        setFormData((prev) => ({ ...prev, name: '', projectNumber: '' }));
        return;
      }
      setGcpLookup({ status: 'loading' });
      debounceRef.current = setTimeout(() => lookupGcpProject(value), 700);
    },
    [lookupGcpProject]
  );

  const handleResync = useCallback(() => {
    const id = editingProject?.projectId ?? formData.projectId;
    if (id) lookupGcpProject(id);
  }, [editingProject, formData.projectId, lookupGcpProject]);

  // ---------------------------------------------------------------------------
  // GCP billing account browse
  // ---------------------------------------------------------------------------

  const fetchGcpBillingAccounts = useCallback(async () => {
    setGcpAccountsLoading(true);
    setGcpAccountsError(null);
    try {
      const res = await api.get<{ data: GcpBillingAccount[] }>('/gcp/billing-accounts');
      setGcpAccounts(res.data ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('gcpLoadAccountsFailed');
      setGcpAccountsError(msg);
    } finally {
      setGcpAccountsLoading(false);
    }
  }, [t]);

  const fetchGcpProjectsForAccount = useCallback(async (billingAccountId: string) => {
    setGcpProjectsLoading(true);
    setGcpProjectsError(null);
    setGcpBillingProjects([]);
    try {
      const res = await api.get<{ data: GcpProjectBillingInfo[] }>(
        `/gcp/billing-accounts/${encodeURIComponent(billingAccountId)}/projects`
      );
      setGcpBillingProjects(res.data ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('gcpLoadProjectsFailed');
      setGcpProjectsError(msg);
    } finally {
      setGcpProjectsLoading(false);
    }
  }, [t]);

  const handleGcpAccountSelect = useCallback(
    (accountId: string) => {
      setSelectedGcpAccount(accountId);
      if (accountId) fetchGcpProjectsForAccount(accountId);
    },
    [fetchGcpProjectsForAccount]
  );

  const handleImportGcpProject = useCallback(
    (gcpProject: GcpProjectBillingInfo) => {
      // Fill form from GCP billing info, then trigger name lookup
      setFormData((prev) => ({
        ...prev,
        projectId: gcpProject.projectId,
        projectNumber: '',
        name: '',
      }));
      // Switch to manual tab so user can see the filled data and adjust IAM role
      setCreateTab('manual');
      lookupGcpProject(gcpProject.projectId);
    },
    [lookupGcpProject]
  );

  // ---------------------------------------------------------------------------
  // Status badge
  // ---------------------------------------------------------------------------

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant="default">{t('statuses.active')}</Badge>;
      case 'SUSPENDED':
        return <Badge variant="secondary">{t('statuses.suspended')}</Badge>;
      case 'NOT_FOUND':
        return <Badge variant="destructive">{t('statuses.notFound')}</Badge>;
      case 'NO_BILLING':
        return <Badge variant="outline">{t('statuses.noBilling')}</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  // ---------------------------------------------------------------------------
  // Table columns
  // ---------------------------------------------------------------------------

  const columns: ColumnDef<Project>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: t('projectName'),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name || row.original.projectId}</div>
            <div className="text-xs text-muted-foreground">{row.original.projectId}</div>
            {row.original.projectNumber && (
              <div className="text-xs text-muted-foreground">#{row.original.projectNumber}</div>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'iamRole',
        header: t('iamRole'),
        cell: ({ row }) =>
          row.original.iamRole ? (
            <span className="font-mono text-xs">{row.original.iamRole}</span>
          ) : (
            '-'
          ),
      },
      {
        accessorKey: 'billingAccount',
        header: t('billingAccount'),
        cell: ({ row }) =>
          row.original.billingAccount?.name ||
          row.original.billingAccount?.billingAccountId ||
          '-',
      },
      {
        accessorKey: 'boundCustomers',
        header: tc('customer'),
        cell: ({ row }) => {
          const customers = row.original.boundCustomers;
          if (!customers || customers.length === 0) return '-';
          return customers.map((c) => c.customerName).join(', ');
        },
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ row }) => getStatusBadge(row.original.status),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Can resource="projects" action="update">
              <Button variant="ghost" size="sm" onClick={() => handleEdit(row.original)}>
                <Pencil className="h-4 w-4 mr-1" />
                {tc('edit')}
              </Button>
            </Can>
          </div>
        ),
      },
    ],
    [t, tc]
  );

  // ---------------------------------------------------------------------------
  // Modal handlers
  // ---------------------------------------------------------------------------

  const handleCreate = () => {
    setEditingProject(null);
    setFormData({ projectId: '', projectNumber: '', name: '', iamRole: '', status: 'ACTIVE' });
    setGcpLookup({ status: 'idle' });
    setCreateTab('manual');
    setSelectedGcpAccount('');
    setGcpBillingProjects([]);
    setGcpAccountsError(null);
    setGcpProjectsError(null);
    setShowModal(true);
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setFormData({
      projectId: project.projectId,
      projectNumber: project.projectNumber || '',
      name: project.name || '',
      iamRole: project.iamRole || '',
      status: project.status,
    });
    setGcpLookup({ status: 'idle' });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      if (editingProject) {
        await api.put(`/projects/${editingProject.id}`, {
          name: formData.name || null,
          projectNumber: formData.projectNumber || null,
          iamRole: formData.iamRole || null,
          status: formData.status,
        });
      } else {
        await api.post('/projects', {
          projectId: formData.projectId,
          projectNumber: formData.projectNumber || null,
          name: formData.name || null,
          iamRole: formData.iamRole || null,
        });
      }
      setShowModal(false);
      fetchProjects();
    } catch (err) {
      console.error('Error saving project:', err);
      setError(editingProject ? 'Failed to update project' : 'Failed to create project');
    } finally {
      setIsSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderGcpNameField = () => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t('projectName')}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={handleResync}
          disabled={
            gcpLookup.status === 'loading' ||
            (!editingProject && !formData.projectId)
          }
        >
          {gcpLookup.status === 'loading' ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <RefreshCw className="h-3 w-3 mr-1" />
          )}
          {t('syncFromGcp')}
        </Button>
      </div>

      <div className="min-h-[36px] rounded-md border border-input bg-muted px-3 py-2 text-sm flex items-center gap-2">
        {gcpLookup.status === 'loading' && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">{t('lookingUp')}</span>
          </>
        )}
        {gcpLookup.status === 'success' && (
          <>
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            <span>{gcpLookup.data.name}</span>
            {gcpLookup.data.projectNumber && (
              <span className="text-xs text-muted-foreground ml-auto">
                #{gcpLookup.data.projectNumber}
              </span>
            )}
          </>
        )}
        {gcpLookup.status === 'error' && (
          <>
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <span className="text-destructive text-xs">{gcpLookup.message}</span>
          </>
        )}
        {gcpLookup.status === 'idle' && (
          <span className="text-muted-foreground">
            {!editingProject ? t('hints.nameFromGcp') : (formData.name || '-')}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t('hints.nameReadOnly')}</p>
    </div>
  );

  const renderGcpBrowseTab = () => (
    <div className="space-y-4">
      {/* Step 1: pick billing account */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t('gcpBillingAccount')}</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={fetchGcpBillingAccounts}
            disabled={gcpAccountsLoading}
          >
            {gcpAccountsLoading ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            {tc('refresh')}
          </Button>
        </div>

        {gcpAccountsError && (
          <p className="text-xs text-destructive">{gcpAccountsError}</p>
        )}

        {gcpAccounts.length === 0 && !gcpAccountsLoading && !gcpAccountsError && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={fetchGcpBillingAccounts}
          >
            <CloudDownload className="h-4 w-4 mr-2" />
            {t('loadGcpAccounts')}
          </Button>
        )}

        {gcpAccounts.length > 0 && (
          <Select value={selectedGcpAccount} onValueChange={handleGcpAccountSelect}>
            <SelectTrigger>
              <SelectValue placeholder={t('selectGcpAccount')} />
            </SelectTrigger>
            <SelectContent>
              {gcpAccounts.map((a) => (
                <SelectItem key={a.billingAccountId} value={a.billingAccountId}>
                  <span className="font-medium">{a.displayName}</span>
                  <span className="text-xs text-muted-foreground ml-2">{a.billingAccountId}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Step 2: project list */}
      {selectedGcpAccount && (
        <div className="space-y-2">
          <Label>{t('gcpProjects')}</Label>

          {gcpProjectsLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tc('loading')}
            </div>
          )}

          {gcpProjectsError && (
            <p className="text-xs text-destructive">{gcpProjectsError}</p>
          )}

          {!gcpProjectsLoading && gcpBillingProjects.length === 0 && !gcpProjectsError && (
            <p className="text-sm text-muted-foreground py-2">{t('noGcpProjects')}</p>
          )}

          {gcpBillingProjects.length > 0 && (
            <div className="border rounded-md divide-y max-h-60 overflow-y-auto">
              {gcpBillingProjects.map((p) => (
                <div
                  key={p.projectId}
                  className="flex items-center justify-between px-3 py-2 hover:bg-muted/50"
                >
                  <div>
                    <div className="text-sm font-medium">{p.projectId}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      {p.billingEnabled ? (
                        <span className="text-green-600">{t('billingEnabled')}</span>
                      ) : (
                        <span className="text-muted-foreground">{t('billingDisabled')}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleImportGcpProject(p)}
                  >
                    <FolderOpen className="h-3 w-3 mr-1" />
                    {t('import')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('subtitle')}</p>
        </div>
        <Can resource="projects" action="create">
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            {t('actions.create')}
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
          data={projects}
          columns={columns}
          isLoading={isLoading}
          searchable
          searchPlaceholder={t('searchPlaceholder')}
          emptyMessage={t('noProjects')}
          pageSize={20}
        />
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingProject ? t('modal.editTitle') : t('modal.createTitle')}
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="space-y-4"
        >
          {/* ---- CREATE mode: tabs ---- */}
          {!editingProject && (
            <Tabs value={createTab} onValueChange={(v) => setCreateTab(v as 'manual' | 'gcp')}>
              <TabsList className="w-full">
                <TabsTrigger value="manual" className="flex-1">
                  {t('tabs.manual')}
                </TabsTrigger>
                <TabsTrigger value="gcp" className="flex-1">
                  <CloudDownload className="h-3 w-3 mr-1" />
                  {t('tabs.importFromGcp')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="manual" className="space-y-4 pt-2">
                {/* Project ID */}
                <div className="space-y-2">
                  <Label htmlFor="projectId">{t('projectId')} *</Label>
                  <Input
                    id="projectId"
                    type="text"
                    value={formData.projectId}
                    onChange={(e) => handleProjectIdChange(e.target.value)}
                    placeholder={t('placeholders.projectId')}
                    required
                  />
                  <p className="text-xs text-muted-foreground">{t('hints.projectId')}</p>
                </div>

                {/* Project Name — read-only from GCP */}
                {renderGcpNameField()}

                {/* IAM Role */}
                <div className="space-y-2">
                  <Label htmlFor="iamRole">{t('iamRole')}</Label>
                  <Input
                    id="iamRole"
                    type="text"
                    value={formData.iamRole}
                    onChange={(e) => setFormData({ ...formData, iamRole: e.target.value })}
                    placeholder={t('placeholders.iamRole')}
                  />
                  <p className="text-xs text-muted-foreground">{t('hints.iamRole')}</p>
                </div>
              </TabsContent>

              <TabsContent value="gcp" className="pt-2">
                {renderGcpBrowseTab()}
              </TabsContent>
            </Tabs>
          )}

          {/* ---- EDIT mode: no tabs ---- */}
          {editingProject && (
            <>
              {/* Project ID read-only */}
              <div className="space-y-2">
                <Label>{t('projectId')}</Label>
                <div className="rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {formData.projectId}
                </div>
              </div>

              {/* Project Name — read-only from GCP */}
              {renderGcpNameField()}

              {/* IAM Role */}
              <div className="space-y-2">
                <Label htmlFor="iamRole">{t('iamRole')}</Label>
                <Input
                  id="iamRole"
                  type="text"
                  value={formData.iamRole}
                  onChange={(e) => setFormData({ ...formData, iamRole: e.target.value })}
                  placeholder={t('placeholders.iamRole')}
                />
                <p className="text-xs text-muted-foreground">{t('hints.iamRole')}</p>
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label htmlFor="status">{t('status')}</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">{t('statuses.active')}</SelectItem>
                    <SelectItem value="SUSPENDED">{t('statuses.suspended')}</SelectItem>
                    <SelectItem value="NOT_FOUND">{t('statuses.notFound')}</SelectItem>
                    <SelectItem value="NO_BILLING">{t('statuses.noBilling')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
              {tc('cancel')}
            </Button>
            {/* In GCP browse tab, the import button handles submit */}
            {(editingProject || createTab === 'manual') && (
              <Button
                type="submit"
                disabled={
                  isSaving ||
                  (!editingProject && !formData.projectId) ||
                  gcpLookup.status === 'loading'
                }
              >
                {editingProject ? tc('save') : tc('create')}
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
}
