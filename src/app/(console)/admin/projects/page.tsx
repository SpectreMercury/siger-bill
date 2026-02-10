'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
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
import { Modal } from '@/components/ui/Modal';
import { Can } from '@/components/auth';
import { Plus, Pencil } from 'lucide-react';

interface ProjectFormData {
  projectId: string;
  name: string;
  status: string;
}

export default function ProjectsPage() {
  const t = useTranslations('projects');
  const tc = useTranslations('common');
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState<ProjectFormData>({
    projectId: '',
    name: '',
    status: 'ACTIVE',
  });
  const [isSaving, setIsSaving] = useState(false);

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

  const columns: ColumnDef<Project>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: t('projectName'),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name || row.original.projectId}</div>
            <div className="text-xs text-muted-foreground">{row.original.projectId}</div>
          </div>
        ),
      },
      {
        accessorKey: 'billingAccount',
        header: t('billingAccount'),
        cell: ({ row }) =>
          row.original.billingAccount?.name || row.original.billingAccount?.billingAccountId || '-',
      },
      {
        accessorKey: 'boundCustomers',
        header: tc('customer'),
        cell: ({ row }) => {
          const customers = row.original.boundCustomers;
          if (!customers || customers.length === 0) return '-';
          return customers.map(c => c.customerName).join(', ');
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

  const handleCreate = () => {
    setEditingProject(null);
    setFormData({
      projectId: '',
      name: '',
      status: 'ACTIVE',
    });
    setShowModal(true);
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setFormData({
      projectId: project.projectId,
      name: project.name || '',
      status: project.status,
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      if (editingProject) {
        await api.put(`/projects/${editingProject.id}`, {
          name: formData.name,
          status: formData.status,
        });
      } else {
        await api.post('/projects', {
          projectId: formData.projectId,
          name: formData.name || null,
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

      {/* Create/Edit Modal */}
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
          <div className="space-y-2">
            <Label htmlFor="projectId">{t('projectId')} *</Label>
            <Input
              id="projectId"
              type="text"
              value={formData.projectId}
              onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
              placeholder={t('placeholders.projectId')}
              required
              disabled={!!editingProject}
            />
            {!editingProject && (
              <p className="text-xs text-muted-foreground">
                {t('hints.projectId')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">{t('projectName')}</Label>
            <Input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={editingProject ? editingProject.projectId : t('placeholders.projectName')}
            />
            {editingProject && !formData.name && (
              <p className="text-xs text-muted-foreground">
                {t('hints.emptyName')}
              </p>
            )}
          </div>

          {editingProject && (
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
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {editingProject ? tc('save') : tc('create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
