'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/client/api';
import { Alert } from '@/components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Switch } from '@/components/ui/shadcn/switch';
import { Modal } from '@/components/ui/Modal';
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  StarOff,
  CheckCircle2,
  XCircle,
  Loader2,
  KeyRound,
  Server,
  FlaskConical,
  FolderOpen,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GcpConnection {
  id: string;
  name: string;
  description: string | null;
  group: string;
  authType: 'SERVICE_ACCOUNT' | 'API_KEY';
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: { firstName: string; lastName: string; email: string } | null;
}

type TestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; message: string; accounts: Array<{ billingAccountId: string; displayName: string }> }
  | { status: 'error'; error: string };

interface FormData {
  name: string;
  description: string;
  group: string;
  authType: 'SERVICE_ACCOUNT' | 'API_KEY';
  // SERVICE_ACCOUNT fields
  clientEmail: string;
  privateKey: string;
  pasteJson: string;
  // API_KEY field
  apiKey: string;
  isDefault: boolean;
  isActive: boolean;
}

const DEFAULT_FORM: FormData = {
  name: '',
  description: '',
  group: '',
  authType: 'SERVICE_ACCOUNT',
  clientEmail: '',
  privateKey: '',
  pasteJson: '',
  apiKey: '',
  isDefault: false,
  isActive: true,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GcpConnectionsPage() {
  const t = useTranslations('gcpConnections');
  const tc = useTranslations('common');

  const [connections, setConnections] = useState<GcpConnection[]>([]);
  const [grouped, setGrouped] = useState<Record<string, GcpConnection[]>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [existingGroups, setExistingGroups] = useState<string[]>([]);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const fetchConnections = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: GcpConnection[]; grouped: Record<string, GcpConnection[]> }>(
        '/admin/gcp-connections'
      );
      setConnections(res.data ?? []);
      setGrouped(res.grouped ?? {});
      setExistingGroups(Object.keys(res.grouped ?? {}));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load GCP connections');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // ---------------------------------------------------------------------------
  // Group collapse
  // ---------------------------------------------------------------------------

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // JSON paste helper
  // ---------------------------------------------------------------------------

  const handlePasteJson = (jsonStr: string) => {
    setFormData((prev) => ({ ...prev, pasteJson: jsonStr }));
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.client_email && parsed.private_key) {
        setFormData((prev) => ({
          ...prev,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
          pasteJson: jsonStr,
        }));
      }
    } catch {
      // not valid JSON yet, ignore
    }
  };

  // ---------------------------------------------------------------------------
  // Modal handlers
  // ---------------------------------------------------------------------------

  const handleCreate = () => {
    setEditingId(null);
    setFormData(DEFAULT_FORM);
    setShowModal(true);
  };

  const handleEdit = (conn: GcpConnection) => {
    setEditingId(conn.id);
    setFormData({
      name: conn.name,
      description: conn.description ?? '',
      group: conn.group,
      authType: conn.authType,
      clientEmail: '',
      privateKey: '',
      pasteJson: '',
      apiKey: '',
      isDefault: conn.isDefault,
      isActive: conn.isActive,
    });
    setShowModal(true);
  };

  const buildCredentials = () => {
    if (formData.authType === 'SERVICE_ACCOUNT') {
      return { client_email: formData.clientEmail, private_key: formData.privateKey };
    }
    return { key: formData.apiKey };
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      const payload = {
        name: formData.name,
        description: formData.description || null,
        group: formData.group,
        authType: formData.authType,
        credentials: buildCredentials(),
        isDefault: formData.isDefault,
        isActive: formData.isActive,
      };

      if (editingId) {
        // Only send credentials if user filled them in
        const creds = formData.authType === 'SERVICE_ACCOUNT'
          ? (formData.clientEmail && formData.privateKey ? buildCredentials() : undefined)
          : (formData.apiKey ? buildCredentials() : undefined);

        await api.put(`/admin/gcp-connections/${editingId}`, {
          ...payload,
          credentials: creds,
        });
      } else {
        await api.post('/admin/gcp-connections', payload);
      }
      setShowModal(false);
      fetchConnections();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save connection');
    } finally {
      setIsSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    setIsDeleting(true);
    try {
      await api.delete(`/admin/gcp-connections/${deleteConfirmId}`);
      setDeleteConfirmId(null);
      fetchConnections();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete connection');
    } finally {
      setIsDeleting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Set default
  // ---------------------------------------------------------------------------

  const handleSetDefault = async (conn: GcpConnection) => {
    try {
      await api.put(`/admin/gcp-connections/${conn.id}`, { isDefault: true });
      fetchConnections();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to set default');
    }
  };

  // ---------------------------------------------------------------------------
  // Test
  // ---------------------------------------------------------------------------

  const handleTest = async (conn: GcpConnection) => {
    setTestStates((prev) => ({ ...prev, [conn.id]: { status: 'loading' } }));
    try {
      const res = await api.post<{
        ok: boolean;
        message?: string;
        error?: string;
        billingAccounts?: Array<{ billingAccountId: string; displayName: string }>;
      }>(`/admin/gcp-connections/${conn.id}/test`, {});

      if (res.ok) {
        setTestStates((prev) => ({
          ...prev,
          [conn.id]: { status: 'success', message: res.message ?? 'OK', accounts: res.billingAccounts ?? [] },
        }));
      } else {
        setTestStates((prev) => ({
          ...prev,
          [conn.id]: { status: 'error', error: res.error ?? 'Unknown error' },
        }));
      }
    } catch (err: unknown) {
      setTestStates((prev) => ({
        ...prev,
        [conn.id]: { status: 'error', error: err instanceof Error ? err.message : 'Test failed' },
      }));
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const authTypeBadge = (type: string) => {
    if (type === 'SERVICE_ACCOUNT')
      return (
        <Badge variant="secondary" className="gap-1">
          <Server className="h-3 w-3" /> Service Account
        </Badge>
      );
    return (
      <Badge variant="outline" className="gap-1">
        <KeyRound className="h-3 w-3" /> API Key
      </Badge>
    );
  };

  const renderTestResult = (id: string) => {
    const state = testStates[id];
    if (!state || state.status === 'idle') return null;
    if (state.status === 'loading') return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> {t('testing')}
      </div>
    );
    if (state.status === 'success') return (
      <div className="text-xs text-green-600 flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" /> {state.message}
      </div>
    );
    return (
      <div className="text-xs text-destructive flex items-start gap-1">
        <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
        <span>{state.error}</span>
      </div>
    );
  };

  const renderConnectionCard = (conn: GcpConnection) => (
    <div key={conn.id} className="border rounded-lg p-4 bg-card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{conn.name}</span>
            {authTypeBadge(conn.authType)}
            {conn.isDefault && (
              <Badge className="gap-1 bg-yellow-100 text-yellow-800 border-yellow-200">
                <Star className="h-3 w-3" /> {t('default')}
              </Badge>
            )}
            {!conn.isActive && (
              <Badge variant="secondary">{tc('inactive')}</Badge>
            )}
          </div>
          {conn.description && (
            <p className="text-xs text-muted-foreground mt-1">{conn.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleTest(conn)}
            disabled={testStates[conn.id]?.status === 'loading'}
          >
            {testStates[conn.id]?.status === 'loading' ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <FlaskConical className="h-3 w-3 mr-1" />
            )}
            {t('test')}
          </Button>
          {!conn.isDefault && (
            <Button variant="ghost" size="sm" onClick={() => handleSetDefault(conn)}>
              <StarOff className="h-3 w-3 mr-1" />
              {t('setDefault')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => handleEdit(conn)}>
            <Pencil className="h-3 w-3 mr-1" />
            {tc('edit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteConfirmId(conn.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {renderTestResult(conn.id)}
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
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t('actions.create')}
        </Button>
      </div>

      {error && <Alert variant="error" onClose={() => setError(null)}>{error}</Alert>}

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {tc('loading')}
        </div>
      )}

      {!isLoading && connections.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Server className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>{t('noConnections')}</p>
            <Button variant="outline" className="mt-4" onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              {t('actions.create')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Grouped connections */}
      {Object.entries(grouped).map(([group, conns]) => (
        <Card key={group}>
          <CardHeader
            className="pb-3 cursor-pointer select-none"
            onClick={() => toggleGroup(group)}
          >
            <CardTitle className="flex items-center gap-2 text-base">
              {collapsedGroups.has(group) ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              {group}
              <Badge variant="secondary" className="ml-auto font-normal">
                {conns.length} {t('connections')}
              </Badge>
            </CardTitle>
          </CardHeader>
          {!collapsedGroups.has(group) && (
            <CardContent className="space-y-3 pt-0">
              {conns.map(renderConnectionCard)}
            </CardContent>
          )}
        </Card>
      ))}

      {/* ------------------------------------------------------------------ */}
      {/* Create / Edit Modal */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingId ? t('modal.editTitle') : t('modal.createTitle')}
        size="md"
      >
        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
          className="space-y-4"
        >
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="conn-name">{t('fields.name')} *</Label>
            <Input
              id="conn-name"
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              placeholder={t('placeholders.name')}
              required
            />
          </div>

          {/* Group */}
          <div className="space-y-2">
            <Label htmlFor="conn-group">{t('fields.group')} *</Label>
            <Input
              id="conn-group"
              value={formData.group}
              onChange={(e) => setFormData((p) => ({ ...p, group: e.target.value }))}
              placeholder={t('placeholders.group')}
              list="group-suggestions"
              required
            />
            {existingGroups.length > 0 && (
              <datalist id="group-suggestions">
                {existingGroups.map((g) => <option key={g} value={g} />)}
              </datalist>
            )}
            <p className="text-xs text-muted-foreground">{t('hints.group')}</p>
          </div>

          {/* Auth Type */}
          <div className="space-y-2">
            <Label>{t('fields.authType')} *</Label>
            <div className="flex gap-3">
              {(['SERVICE_ACCOUNT', 'API_KEY'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, authType: type }))}
                  className={`flex-1 flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                    formData.authType === type
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-input hover:bg-muted/50'
                  }`}
                >
                  {type === 'SERVICE_ACCOUNT' ? <Server className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                  {type === 'SERVICE_ACCOUNT' ? 'Service Account' : 'API Key'}
                </button>
              ))}
            </div>
          </div>

          {/* Credentials — SERVICE_ACCOUNT */}
          {formData.authType === 'SERVICE_ACCOUNT' && (
            <div className="space-y-3 rounded-md border p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground font-medium">{t('hints.pasteJsonHint')}</p>
              <div className="space-y-2">
                <Label htmlFor="paste-json">{t('fields.pasteJson')}</Label>
                <Textarea
                  id="paste-json"
                  rows={3}
                  placeholder={t('placeholders.pasteJson')}
                  value={formData.pasteJson}
                  onChange={(e) => handlePasteJson(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="client-email">{t('fields.clientEmail')}{editingId ? '' : ' *'}</Label>
                <Input
                  id="client-email"
                  value={formData.clientEmail}
                  onChange={(e) => setFormData((p) => ({ ...p, clientEmail: e.target.value }))}
                  placeholder="service-account@project.iam.gserviceaccount.com"
                  required={!editingId}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="private-key">{t('fields.privateKey')}{editingId ? '' : ' *'}</Label>
                <Textarea
                  id="private-key"
                  rows={3}
                  value={formData.privateKey}
                  onChange={(e) => setFormData((p) => ({ ...p, privateKey: e.target.value }))}
                  placeholder={editingId ? t('placeholders.privateKeyEdit') : '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----'}
                  className="font-mono text-xs"
                  required={!editingId}
                />
                {editingId && (
                  <p className="text-xs text-muted-foreground">{t('hints.privateKeyEdit')}</p>
                )}
              </div>
            </div>
          )}

          {/* Credentials — API_KEY */}
          {formData.authType === 'API_KEY' && (
            <div className="space-y-2">
              <Label htmlFor="api-key">{t('fields.apiKey')}{editingId ? '' : ' *'}</Label>
              <Input
                id="api-key"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData((p) => ({ ...p, apiKey: e.target.value }))}
                placeholder={editingId ? t('placeholders.apiKeyEdit') : 'AIzaSy...'}
                required={!editingId}
              />
              {editingId && (
                <p className="text-xs text-muted-foreground">{t('hints.apiKeyEdit')}</p>
              )}
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="conn-desc">{t('fields.description')}</Label>
            <Input
              id="conn-desc"
              value={formData.description}
              onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
              placeholder={t('placeholders.description')}
            />
          </div>

          {/* Toggles */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="is-default"
                checked={formData.isDefault}
                onCheckedChange={(v) => setFormData((p) => ({ ...p, isDefault: v }))}
              />
              <Label htmlFor="is-default" className="cursor-pointer">{t('fields.isDefault')}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="is-active"
                checked={formData.isActive}
                onCheckedChange={(v) => setFormData((p) => ({ ...p, isActive: v }))}
              />
              <Label htmlFor="is-active" className="cursor-pointer">{t('fields.isActive')}</Label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {editingId ? tc('save') : tc('create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        title={t('modal.deleteTitle')}
        size="sm"
      >
        <p className="text-sm text-muted-foreground mb-6">{t('modal.deleteConfirm')}</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
            {tc('cancel')}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
            {tc('delete')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
