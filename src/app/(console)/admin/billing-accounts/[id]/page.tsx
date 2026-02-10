'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import { Alert } from '@/components/ui';
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
import { Separator } from '@/components/ui/shadcn/separator';
import { Modal } from '@/components/ui/Modal';
import { Can } from '@/components/auth';
import {
  ArrowLeft,
  Pencil,
  Trash2,
  FolderKanban,
  Building2,
  Loader2,
} from 'lucide-react';

interface Project {
  id: string;
  projectId: string;
  name: string | null;
  status: string;
  customers: Array<{
    id: string;
    name: string;
    externalId: string | null;
  }>;
}

interface BillingAccountDetail {
  id: string;
  billingAccountId: string;
  name: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'UNKNOWN';
  createdAt: string;
  updatedAt: string;
  projects: Project[];
}

export default function BillingAccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('billingAccounts');
  const tc = useTranslations('common');

  const [account, setAccount] = useState<BillingAccountDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    status: 'ACTIVE',
  });

  const fetchAccount = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<BillingAccountDetail>(`/billing-accounts/${params.id}`);
      setAccount(response);
      setFormData({
        name: response.name || '',
        status: response.status,
      });
    } catch (err) {
      console.error('Error fetching billing account:', err);
      setError(t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [params.id, t]);

  useEffect(() => {
    fetchAccount();
  }, [fetchAccount]);

  const handleUpdate = async () => {
    setIsSaving(true);
    setError(null);

    try {
      await api.put(`/billing-accounts/${params.id}`, {
        name: formData.name || null,
        status: formData.status,
      });
      setShowEditModal(false);
      fetchAccount();
    } catch (err) {
      console.error('Error updating billing account:', err);
      setError(err instanceof Error ? err.message : t('updateFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      await api.delete(`/billing-accounts/${params.id}`);
      router.push('/admin/billing-accounts');
    } catch (err) {
      console.error('Error deleting billing account:', err);
      setError(err instanceof Error ? err.message : t('deleteFailed'));
      setShowDeleteModal(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant="default">{tc('active')}</Badge>;
      case 'SUSPENDED':
        return <Badge variant="destructive">{tc('suspended')}</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getProjectStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return <Badge variant="default">{tc('active')}</Badge>;
      case 'SUSPENDED':
        return <Badge variant="secondary">{tc('suspended')}</Badge>;
      case 'NOT_FOUND':
        return <Badge variant="destructive">Not Found</Badge>;
      case 'NO_BILLING':
        return <Badge variant="outline">No Billing</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="space-y-6">
        <Alert variant="error">{t('notFound')}</Alert>
        <Button variant="outline" onClick={() => router.push('/admin/billing-accounts')}>
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
            onClick={() => router.push('/admin/billing-accounts')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {account.name || account.billingAccountId}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {account.billingAccountId}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-12 sm:ml-0">
          <Can resource="billing_accounts" action="update">
            <Button variant="outline" onClick={() => setShowEditModal(true)}>
              <Pencil className="h-4 w-4 mr-2" />
              {tc('edit')}
            </Button>
          </Can>
          <Can resource="billing_accounts" action="delete">
            <Button
              variant="destructive"
              onClick={() => setShowDeleteModal(true)}
              disabled={account.projects.length > 0}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {tc('delete')}
            </Button>
          </Can>
        </div>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Account Info */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">{t('detail.info')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <p className="text-sm text-muted-foreground">{t('billingAccountId')}</p>
            <p className="font-medium font-mono">{account.billingAccountId}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('name')}</p>
            <p className="font-medium">{account.name || '-'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{tc('status')}</p>
            <div className="mt-1">{getStatusBadge(account.status)}</div>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('projectCount')}</p>
            <p className="font-medium">{account.projects.length}</p>
          </div>
        </div>
      </Card>

      {/* Projects List */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <FolderKanban className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{t('detail.projects')}</h2>
        </div>

        {account.projects.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FolderKanban className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>{t('detail.noProjects')}</p>
            <p className="text-sm mt-1">{t('detail.noProjectsHint')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {account.projects.map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between p-4 rounded-lg border bg-muted/30"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/admin/projects`}
                      className="font-medium hover:underline"
                    >
                      {project.name || project.projectId}
                    </Link>
                    {getProjectStatusBadge(project.status)}
                  </div>
                  <p className="text-sm text-muted-foreground font-mono">
                    {project.projectId}
                  </p>
                </div>

                {/* Bound Customers */}
                {project.customers.length > 0 && (
                  <div className="flex items-center gap-2 ml-4">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-wrap gap-1">
                      {project.customers.map((customer) => (
                        <Link
                          key={customer.id}
                          href={`/admin/customers`}
                          className="text-sm text-primary hover:underline"
                        >
                          {customer.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title={t('modal.editTitle')}
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleUpdate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="edit-name">{t('name')}</Label>
            <Input
              id="edit-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={account.billingAccountId}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-status">{tc('status')}</Label>
            <Select
              value={formData.status}
              onValueChange={(value) => setFormData({ ...formData, status: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">{tc('active')}</SelectItem>
                <SelectItem value="SUSPENDED">{tc('suspended')}</SelectItem>
                <SelectItem value="UNKNOWN">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {tc('save')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title={t('modal.deleteTitle')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            {t('modal.deleteConfirm', { name: account.name || account.billingAccountId })}
          </p>

          <Separator />

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
              {tc('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {tc('delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
