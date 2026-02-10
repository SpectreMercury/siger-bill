'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ColumnDef } from '@tanstack/react-table';
import { api } from '@/lib/client/api';
import { DataTable, Button, Alert } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Can } from '@/components/auth';
import { Plus, ExternalLink, UserCheck, UserX, Shield, Building2 } from 'lucide-react';

interface Role {
  id: string;
  name: string;
  description: string | null;
}

interface Customer {
  id: string;
  name: string;
  externalId: string | null;
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: Role[];
  createdAt: string;
}

interface CreateUserForm {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  roleId: string;
  customerId: string;
}

export default function UsersPage() {
  const router = useRouter();
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState<CreateUserForm>({
    email: '',
    firstName: '',
    lastName: '',
    password: '',
    roleId: '',
    customerId: '',
  });

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [usersResponse, rolesResponse, customersResponse] = await Promise.all([
        api.get<{ data: User[] }>('/users'),
        api.get<{ data: Role[] }>('/roles'),
        api.get<{ data: Customer[] }>('/customers'),
      ]);
      setUsers(usersResponse.data || []);
      setRoles(rolesResponse.data || []);
      setCustomers(customersResponse.data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to load users');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreate = () => {
    setFormData({
      email: '',
      firstName: '',
      lastName: '',
      password: '',
      roleId: '',
      customerId: '',
    });
    setShowCreateModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    setError(null);
    try {
      // Create user with role
      const userResponse = await api.post<{ id: string }>('/users', {
        email: formData.email,
        firstName: formData.firstName,
        lastName: formData.lastName,
        password: formData.password,
        roleIds: formData.roleId ? [formData.roleId] : [],
      });

      // If customer is selected, add scope
      if (formData.customerId && userResponse.id) {
        await api.post(`/users/${userResponse.id}/scopes`, {
          scopeType: 'CUSTOMER',
          scopeId: formData.customerId,
        });
      }

      setShowCreateModal(false);
      fetchUsers();
    } catch (err) {
      console.error('Error creating user:', err);
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsSaving(false);
    }
  };

  // Role descriptions with clear explanations
  const roleDescriptions: Record<string, { title: string; description: string; permissions: string[] }> = {
    super_admin: {
      title: t('roles.super_admin'),
      description: t('roles.super_admin_desc'),
      permissions: [],
    },
    admin: {
      title: t('roles.admin'),
      description: t('roles.admin_desc'),
      permissions: [],
    },
    finance: {
      title: t('roles.finance'),
      description: t('roles.finance_desc'),
      permissions: [],
    },
    viewer: {
      title: t('roles.viewer'),
      description: t('roles.viewer_desc'),
      permissions: [],
    },
  };

  const getSelectedRoleInfo = () => {
    if (!formData.roleId) return null;
    const role = roles.find((r) => r.id === formData.roleId);
    if (!role) return null;
    return {
      ...role,
      ...(roleDescriptions[role.name] || {
        title: role.name,
        description: role.description || 'Custom role',
        permissions: []
      }),
    };
  };

  const selectedRoleInfo = getSelectedRoleInfo();
  const needsCustomerScope = selectedRoleInfo && !['super_admin'].includes(selectedRoleInfo.name);

  const columns: ColumnDef<User>[] = useMemo(
    () => [
      {
        accessorKey: 'email',
        header: t('email'),
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.email}</p>
            <p className="text-sm text-muted-foreground">
              {row.original.firstName} {row.original.lastName}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'roles',
        header: t('roles'),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.roles.map((role) => (
              <Badge
                key={role.id}
                variant={role.name === 'super_admin' ? 'default' : 'secondary'}
              >
                {role.name}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        accessorKey: 'isActive',
        header: t('status'),
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
            {row.original.isActive ? (
              <><UserCheck className="h-3 w-3 mr-1" /> {tc('active')}</>
            ) : (
              <><UserX className="h-3 w-3 mr-1" /> {tc('inactive')}</>
            )}
          </Badge>
        ),
      },
      {
        accessorKey: 'lastLoginAt',
        header: t('lastLogin'),
        cell: ({ row }) =>
          row.original.lastLoginAt
            ? new Date(row.original.lastLoginAt).toLocaleString()
            : tc('never'),
      },
      {
        accessorKey: 'createdAt',
        header: tc('createdAt'),
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/admin/users/${row.original.id}`)}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            {t('actions.manage')}
          </Button>
        ),
      },
    ],
    [router, t, tc]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('subtitle')}
          </p>
        </div>
        <Can resource="users" action="create">
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
          data={users}
          columns={columns}
          isLoading={isLoading}
          searchable
          searchPlaceholder={t('searchPlaceholder')}
          emptyMessage={t('noUsers')}
          pageSize={20}
        />
      </Card>

      {/* Create User Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={t('modal.createTitle')}
        size="lg"
      >
        <div className="space-y-6">
          {/* Basic Info Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              {t('modal.basicInfo')}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">{t('firstName')} *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  className="mt-1"
                  placeholder={t('placeholders.firstName')}
                />
              </div>
              <div>
                <Label htmlFor="lastName">{t('lastName')} *</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className="mt-1"
                  placeholder={t('placeholders.lastName')}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="email">{t('email')} *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="mt-1"
                placeholder={t('placeholders.email')}
              />
            </div>

            <div>
              <Label htmlFor="password">{t('password')} *</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="mt-1"
                placeholder={t('passwordHint')}
              />
            </div>
          </div>

          {/* Role Section */}
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                {t('modal.rolePermissions')}
              </h3>
            </div>

            <div>
              <Label>{t('role')} *</Label>
              <Select
                value={formData.roleId}
                onValueChange={(value) => setFormData({ ...formData, roleId: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={t('placeholders.chooseRole')} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{role.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Role Description Card */}
            {selectedRoleInfo && (
              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/10 p-2">
                    <Shield className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm">{selectedRoleInfo.title}</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      {selectedRoleInfo.description}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Customer Scope Section */}
          {needsCustomerScope && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  {t('customerAccess')}
                </h3>
              </div>

              <p className="text-sm text-muted-foreground">
                {t('customerAccessNote')}
              </p>

              <div>
                <Label>{tc('customer')}</Label>
                <Select
                  value={formData.customerId || 'none'}
                  onValueChange={(value) => setFormData({ ...formData, customerId: value === 'none' ? '' : value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={tc('selectCustomer')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-muted-foreground">{t('noCustomerAssigned')}</span>
                    </SelectItem>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        <div className="flex items-center gap-2">
                          <span>{customer.name}</span>
                          {customer.externalId && (
                            <span className="text-muted-foreground text-xs">
                              ({customer.externalId})
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {formData.customerId && (
                <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950 p-3">
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {t('restrictedNote')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>
              {tc('cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.email || !formData.password || !formData.roleId || isSaving}
              isLoading={isSaving}
            >
              {tc('create')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
