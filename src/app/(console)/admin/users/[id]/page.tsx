'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import { Button, Alert } from '@/components/ui';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/shadcn/select';
import { Can } from '@/components/auth';
import {
  ArrowLeft,
  Key,
  UserCog,
  Shield,
  UserCheck,
  UserX,
  Trash2,
  Plus,
} from 'lucide-react';

interface Role {
  id: string;
  name: string;
  description: string | null;
}

interface UserScope {
  id: string;
  scopeType: 'CUSTOMER' | 'BILLING' | 'PROJECT';
  scopeId: string;
  name?: string;
  externalId?: string;
  createdAt: string;
}

interface Customer {
  id: string;
  name: string;
  externalId: string | null;
}

interface UserDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: Role[];
  scopes: UserScope[];
  _count: {
    auditLogs: number;
    invoiceRuns: number;
  };
  createdAt: string;
  updatedAt: string;
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal states
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [showEditRolesModal, setShowEditRolesModal] = useState(false);
  const [showAddScopeModal, setShowAddScopeModal] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);

  // Form states
  const [newPassword, setNewPassword] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedScopeType, setSelectedScopeType] = useState<string>('CUSTOMER');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchUser = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [userResponse, rolesResponse, customersResponse] = await Promise.all([
        api.get<UserDetail>(`/users/${id}`),
        api.get<{ data: Role[] }>('/roles'),
        api.get<{ data: Customer[] }>('/customers'),
      ]);
      setUser(userResponse);
      setAllRoles(rolesResponse.data || []);
      setCustomers(customersResponse.data || []);
      setSelectedRoles(userResponse.roles.map((r) => r.id));
    } catch (err) {
      console.error('Error fetching user:', err);
      setError('Failed to load user');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const handleResetPassword = async () => {
    setIsSaving(true);
    try {
      await api.post(`/users/${id}/reset-password`, { newPassword });
      setShowResetPasswordModal(false);
      setNewPassword('');
      setSuccessMessage('Password reset successfully');
    } catch (err) {
      console.error('Error resetting password:', err);
      setError('Failed to reset password');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateRoles = async () => {
    setIsSaving(true);
    try {
      await api.put(`/users/${id}`, { roleIds: selectedRoles });
      setShowEditRolesModal(false);
      fetchUser();
      setSuccessMessage('Roles updated successfully');
    } catch (err) {
      console.error('Error updating roles:', err);
      setError('Failed to update roles');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddScope = async () => {
    if (!selectedCustomerId) return;
    setIsSaving(true);
    try {
      await api.post(`/users/${id}/scopes`, {
        scopeType: selectedScopeType,
        scopeId: selectedCustomerId,
      });
      setShowAddScopeModal(false);
      setSelectedCustomerId('');
      fetchUser();
      setSuccessMessage('Scope added successfully');
    } catch (err) {
      console.error('Error adding scope:', err);
      setError('Failed to add scope');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveScope = async (scopeId: string) => {
    try {
      await api.delete(`/users/${id}/scopes`, { scopeId });
      fetchUser();
      setSuccessMessage('Scope removed');
    } catch (err) {
      console.error('Error removing scope:', err);
      setError('Failed to remove scope');
    }
  };

  const handleDeactivate = async () => {
    setIsSaving(true);
    try {
      await api.delete(`/users/${id}`);
      router.push('/admin/users');
    } catch (err) {
      console.error('Error deactivating user:', err);
      setError('Failed to deactivate user');
      setIsSaving(false);
    }
  };

  const handleActivate = async () => {
    setIsSaving(true);
    try {
      await api.put(`/users/${id}`, { isActive: true });
      fetchUser();
      setSuccessMessage('User activated');
    } catch (err) {
      console.error('Error activating user:', err);
      setError('Failed to activate user');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-muted rounded w-48 animate-pulse" />
        <div className="h-64 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">User not found</p>
        <Link href="/admin/users">
          <Button variant="secondary" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Users
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/admin/users">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              {user.firstName} {user.lastName}
            </h1>
            <Badge variant={user.isActive ? 'default' : 'secondary'}>
              {user.isActive ? (
                <><UserCheck className="h-3 w-3 mr-1" /> Active</>
              ) : (
                <><UserX className="h-3 w-3 mr-1" /> Inactive</>
              )}
            </Badge>
          </div>
          <p className="text-muted-foreground">{user.email}</p>
        </div>

        <Can resource="users" action="update">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowResetPasswordModal(true)}>
              <Key className="h-4 w-4 mr-2" />
              Reset Password
            </Button>
            {user.isActive ? (
              <Button variant="danger" onClick={() => setShowDeactivateConfirm(true)}>
                <UserX className="h-4 w-4 mr-2" />
                Deactivate
              </Button>
            ) : (
              <Button onClick={handleActivate} disabled={isSaving}>
                <UserCheck className="h-4 w-4 mr-2" />
                Activate
              </Button>
            )}
          </div>
        </Can>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success" onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      {/* User Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Roles Card */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center">
              <Shield className="h-5 w-5 mr-2" />
              Roles
            </h3>
            <Can resource="users" action="update">
              <Button variant="ghost" size="sm" onClick={() => setShowEditRolesModal(true)}>
                <UserCog className="h-4 w-4 mr-1" />
                Edit
              </Button>
            </Can>
          </div>
          <div className="space-y-2">
            {user.roles.length === 0 ? (
              <p className="text-muted-foreground">No roles assigned</p>
            ) : (
              user.roles.map((role) => (
                <div key={role.id} className="flex items-center justify-between">
                  <div>
                    <Badge variant={role.name === 'super_admin' ? 'default' : 'secondary'}>
                      {role.name}
                    </Badge>
                    {role.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {role.description}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Stats Card */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Activity</h3>
          <div className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Login</span>
              <span className="font-medium">
                {user.lastLoginAt
                  ? new Date(user.lastLoginAt).toLocaleString()
                  : 'Never'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Audit Logs</span>
              <span className="font-medium">{user._count.auditLogs}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Invoice Runs</span>
              <span className="font-medium">{user._count.invoiceRuns}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span className="font-medium">
                {new Date(user.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Scopes Card */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Customer Scopes</h3>
          <Can resource="users" action="update">
            <Button size="sm" onClick={() => setShowAddScopeModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Scope
            </Button>
          </Can>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Scopes restrict which customer data this user can access.
          Users without scopes have access based on their role permissions.
        </p>
        {user.scopes.length === 0 ? (
          <p className="text-muted-foreground py-4">
            No scopes assigned - user has full access based on roles
          </p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-left font-medium">Customer</th>
                  <th className="px-4 py-2 text-left font-medium">Added</th>
                  <th className="px-4 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {user.scopes.map((scope) => (
                  <tr key={scope.id} className="border-t">
                    <td className="px-4 py-2">
                      <Badge variant="secondary">{scope.scopeType}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      <div>
                        <p className="font-medium">{scope.name || scope.scopeId}</p>
                        {scope.externalId && (
                          <p className="text-xs text-muted-foreground">
                            {scope.externalId}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(scope.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Can resource="users" action="update">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveScope(scope.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </Can>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Reset Password Modal */}
      <Modal
        isOpen={showResetPasswordModal}
        onClose={() => setShowResetPasswordModal(false)}
        title="Reset Password"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="newPassword">New Password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 8 chars, uppercase, lowercase, number"
              className="mt-1"
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowResetPasswordModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword} disabled={!newPassword || isSaving}>
              Reset Password
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Roles Modal */}
      <Modal
        isOpen={showEditRolesModal}
        onClose={() => setShowEditRolesModal(false)}
        title="Edit Roles"
        size="sm"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            {allRoles.map((role) => (
              <div key={role.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`role-edit-${role.id}`}
                  checked={selectedRoles.includes(role.id)}
                  onCheckedChange={() => {
                    setSelectedRoles((prev) =>
                      prev.includes(role.id)
                        ? prev.filter((id) => id !== role.id)
                        : [...prev, role.id]
                    );
                  }}
                />
                <label
                  htmlFor={`role-edit-${role.id}`}
                  className="text-sm font-medium leading-none"
                >
                  {role.name}
                  {role.description && (
                    <span className="text-muted-foreground ml-2">
                      - {role.description}
                    </span>
                  )}
                </label>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowEditRolesModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateRoles} disabled={isSaving}>
              Save Roles
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Scope Modal */}
      <Modal
        isOpen={showAddScopeModal}
        onClose={() => setShowAddScopeModal(false)}
        title="Add Scope"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <Label>Scope Type</Label>
            <Select value={selectedScopeType} onValueChange={setSelectedScopeType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CUSTOMER">Customer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Customer</Label>
            <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select customer..." />
              </SelectTrigger>
              <SelectContent>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                    {customer.externalId && ` (${customer.externalId})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowAddScopeModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddScope} disabled={!selectedCustomerId || isSaving}>
              Add Scope
            </Button>
          </div>
        </div>
      </Modal>

      {/* Deactivate Confirmation */}
      <ConfirmDialog
        isOpen={showDeactivateConfirm}
        onClose={() => setShowDeactivateConfirm(false)}
        onConfirm={handleDeactivate}
        title="Deactivate User"
        message={`Are you sure you want to deactivate ${user.firstName} ${user.lastName}? They will no longer be able to log in.`}
        confirmText="Deactivate"
        isLoading={isSaving}
      />
    </div>
  );
}
