'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { PaginatedResponse, Project } from '@/lib/client/types';
import { DataTable, Alert } from '@/components/ui';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Modal } from '@/components/ui/Modal';
import { Label } from '@/components/ui/shadcn/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Can } from '@/components/auth';
import { Plus, Unlink } from 'lucide-react';

interface CustomerProject {
  id: string;
  projectId: string;
  projectName: string | null;
  billingAccount: {
    billingAccountId: string;
    name: string | null;
  } | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CustomerProjectsTabProps {
  customerId: string;
}

export function CustomerProjectsTab({ customerId }: CustomerProjectsTabProps) {
  const [customerProjects, setCustomerProjects] = useState<CustomerProject[]>([]);
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBindModal, setShowBindModal] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [projectsRes, allProjectsRes] = await Promise.all([
        api.get<{ data: CustomerProject[] }>(`/customers/${customerId}/projects`),
        api.get<PaginatedResponse<Project>>('/projects'),
      ]);

      setCustomerProjects(projectsRes.data || []);
      setAvailableProjects(allProjectsRes.data || []);
    } catch (err) {
      console.error('Error fetching projects:', err);
      setError('Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const unboundProjects = useMemo(() => {
    const boundProjectIds = new Set(customerProjects.filter(cp => cp.isActive).map(cp => cp.projectId));
    return availableProjects.filter(p => !boundProjectIds.has(p.projectId) && p.status === 'ACTIVE');
  }, [customerProjects, availableProjects]);

  const handleBind = async () => {
    if (!selectedProjectId) return;
    setIsSaving(true);

    try {
      await api.post(`/customers/${customerId}/projects`, {
        projectId: selectedProjectId,
      });
      setShowBindModal(false);
      setSelectedProjectId('');
      fetchData();
    } catch (err) {
      console.error('Error binding project:', err);
      setError('Failed to bind project');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnbind = async (projectId: string) => {
    if (!confirm('Are you sure you want to unbind this project?')) return;

    try {
      await api.delete(`/customers/${customerId}/projects/${projectId}`);
      fetchData();
    } catch (err) {
      console.error('Error unbinding project:', err);
      setError('Failed to unbind project');
    }
  };

  const columns: ColumnDef<CustomerProject>[] = useMemo(
    () => [
      {
        accessorKey: 'projectName',
        header: 'Project Name',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.projectName || row.original.projectId}</div>
            <div className="text-xs text-muted-foreground">{row.original.projectId}</div>
          </div>
        ),
      },
      {
        accessorKey: 'billingAccount',
        header: 'Billing Account',
        cell: ({ row }) => row.original.billingAccount?.name || row.original.billingAccount?.billingAccountId || '-',
      },
      {
        accessorKey: 'startDate',
        header: 'Start Date',
        cell: ({ row }) => row.original.startDate ? new Date(row.original.startDate).toLocaleDateString() : '-',
      },
      {
        accessorKey: 'endDate',
        header: 'End Date',
        cell: ({ row }) =>
          row.original.endDate ? new Date(row.original.endDate).toLocaleDateString() : '-',
      },
      {
        accessorKey: 'isActive',
        header: 'Binding Status',
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
            <Can resource="customer_projects" action="unbind">
              {row.original.isActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleUnbind(row.original.projectId)}
                >
                  <Unlink className="h-4 w-4 mr-1" />
                  Unbind
                </Button>
              )}
            </Can>
          </div>
        ),
      },
    ],
    [customerId]
  );

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Bound Projects</h3>
        <Can resource="customer_projects" action="bind">
          <Button onClick={() => setShowBindModal(true)} disabled={unboundProjects.length === 0}>
            <Plus className="h-4 w-4 mr-2" />
            Bind Project
          </Button>
        </Can>
      </div>

      {error && (
        <Alert variant="error" className="mb-4" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <DataTable
        data={customerProjects}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No projects bound to this customer"
        pageSize={10}
      />

      {/* Bind Project Modal */}
      <Modal
        isOpen={showBindModal}
        onClose={() => setShowBindModal(false)}
        title="Bind Project"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <Label>Select Project</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {unboundProjects.map((project) => (
                  <SelectItem key={project.id} value={project.projectId}>
                    {project.name || project.projectId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowBindModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleBind} disabled={!selectedProjectId || isSaving}>
              {isSaving ? 'Binding...' : 'Bind'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
