'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { DataTable, Button, Alert } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Eye, FileJson, Search } from 'lucide-react';

interface AuditLog {
  id: string;
  action: string;
  targetTable: string;
  targetId: string | null;
  actor: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface FiltersResponse {
  actions: string[];
  tables: string[];
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [availableTables, setAvailableTables] = useState<string[]>([]);

  // Filter state
  const [actionFilter, setActionFilter] = useState<string>('');
  const [tableFilter, setTableFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Detail modal
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (actionFilter) params.set('action', actionFilter);
      if (tableFilter) params.set('targetTable', tableFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const response = await api.get<{
        data: AuditLog[];
        filters: FiltersResponse;
      }>(`/audit-logs?${params.toString()}`);

      setLogs(response.data || []);
      setAvailableActions(response.filters?.actions || []);
      setAvailableTables(response.filters?.tables || []);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
      setError('Failed to load audit logs');
    } finally {
      setIsLoading(false);
    }
  }, [actionFilter, tableFilter, startDate, endDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const getActionColor = (action: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (action.includes('DELETE') || action.includes('UNBIND')) return 'destructive';
    if (action.includes('CREATE') || action.includes('BIND')) return 'default';
    if (action.includes('UPDATE') || action.includes('LOCK')) return 'secondary';
    return 'outline';
  };

  const columns: ColumnDef<AuditLog>[] = useMemo(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'Time',
        cell: ({ row }) => (
          <span className="text-sm">
            {new Date(row.original.createdAt).toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: 'action',
        header: 'Action',
        cell: ({ row }) => (
          <Badge variant={getActionColor(row.original.action)}>
            {row.original.action}
          </Badge>
        ),
      },
      {
        accessorKey: 'targetTable',
        header: 'Resource',
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono text-xs">
            {row.original.targetTable}
          </Badge>
        ),
      },
      {
        accessorKey: 'actor',
        header: 'User',
        cell: ({ row }) =>
          row.original.actor ? (
            <div className="text-sm">
              <p className="font-medium">
                {row.original.actor.firstName} {row.original.actor.lastName}
              </p>
              <p className="text-muted-foreground text-xs">
                {row.original.actor.email}
              </p>
            </div>
          ) : (
            <span className="text-muted-foreground">System</span>
          ),
      },
      {
        accessorKey: 'targetId',
        header: 'Target ID',
        cell: ({ row }) =>
          row.original.targetId ? (
            <code className="text-xs bg-muted px-2 py-1 rounded">
              {row.original.targetId.slice(0, 8)}...
            </code>
          ) : (
            '-'
          ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedLog(row.original)}
          >
            <Eye className="h-4 w-4 mr-1" />
            Details
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <p className="text-muted-foreground text-sm mt-1">
          View system activity and change history
        </p>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <Label>Action</Label>
            <Select value={actionFilter || 'all'} onValueChange={(v) => setActionFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {availableActions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Resource</Label>
            <Select value={tableFilter || 'all'} onValueChange={(v) => setTableFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="All resources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All resources</SelectItem>
                {availableTables.map((table) => (
                  <SelectItem key={table} value={table}>
                    {table}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>End Date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={fetchLogs} className="w-full">
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
        </div>
      </Card>

      {/* Logs Table */}
      <Card>
        <DataTable
          data={logs}
          columns={columns}
          isLoading={isLoading}
          emptyMessage="No audit logs found"
          pageSize={50}
        />
      </Card>

      {/* Detail Modal */}
      <Modal
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title="Audit Log Details"
        size="lg"
      >
        {selectedLog && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Timestamp</p>
                <p className="font-medium">
                  {new Date(selectedLog.createdAt).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Action</p>
                <Badge variant={getActionColor(selectedLog.action)}>
                  {selectedLog.action}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Resource</p>
                <p className="font-mono">{selectedLog.targetTable}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Target ID</p>
                <p className="font-mono text-xs">{selectedLog.targetId || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">User</p>
                <p className="font-medium">
                  {selectedLog.actor
                    ? `${selectedLog.actor.firstName} ${selectedLog.actor.lastName}`
                    : 'System'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">IP Address</p>
                <p className="font-mono text-xs">{selectedLog.ipAddress || '-'}</p>
              </div>
            </div>

            {selectedLog.beforeData && (
              <div>
                <p className="text-muted-foreground flex items-center mb-2">
                  <FileJson className="h-4 w-4 mr-1" />
                  Before Data
                </p>
                <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto max-h-48">
                  {JSON.stringify(selectedLog.beforeData, null, 2)}
                </pre>
              </div>
            )}

            {selectedLog.afterData && (
              <div>
                <p className="text-muted-foreground flex items-center mb-2">
                  <FileJson className="h-4 w-4 mr-1" />
                  After Data
                </p>
                <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto max-h-48">
                  {JSON.stringify(selectedLog.afterData, null, 2)}
                </pre>
              </div>
            )}

            <div className="flex justify-end pt-4">
              <Button variant="secondary" onClick={() => setSelectedLog(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
