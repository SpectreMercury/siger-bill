'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/client/api';
import { Button, Alert } from '@/components/ui';
import { Card } from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { Separator } from '@/components/ui/shadcn/separator';
import { User, Lock, Shield } from 'lucide-react';

export default function SettingsPage() {
  const { user } = useAuth();
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const handleChangePassword = async () => {
    setError(null);
    setSuccess(null);

    // Validate
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      setError('Please fill in all password fields');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    if (!/[A-Z]/.test(passwordForm.newPassword)) {
      setError('New password must contain at least one uppercase letter');
      return;
    }

    if (!/[a-z]/.test(passwordForm.newPassword)) {
      setError('New password must contain at least one lowercase letter');
      return;
    }

    if (!/[0-9]/.test(passwordForm.newPassword)) {
      setError('New password must contain at least one number');
      return;
    }

    setIsChangingPassword(true);

    try {
      await api.post('/me/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });

      setSuccess('Password changed successfully');
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (err) {
      console.error('Error changing password:', err);
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t('subtitle')}
        </p>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert variant="success" onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {/* Profile Info */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <User className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">{t('profile')}</h2>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">{tc('name')}</p>
            <p className="font-medium">
              {user?.firstName} {user?.lastName}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{tc('email')}</p>
            <p className="font-medium">{user?.email}</p>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="flex items-center gap-3 mb-3">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{tc('roles')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {user?.roles?.map((role) => (
            <Badge
              key={role}
              variant={role === 'super_admin' ? 'default' : 'secondary'}
            >
              {role}
            </Badge>
          )) || <span className="text-muted-foreground text-sm">{t('noRoles')}</span>}
        </div>
      </Card>

      {/* Change Password */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <Lock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">{t('changePassword')}</h2>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="currentPassword">{t('currentPassword')}</Label>
            <Input
              id="currentPassword"
              type="password"
              value={passwordForm.currentPassword}
              onChange={(e) =>
                setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
              }
              className="mt-1"
              placeholder={t('placeholders.currentPassword')}
            />
          </div>

          <div>
            <Label htmlFor="newPassword">{t('newPassword')}</Label>
            <Input
              id="newPassword"
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) =>
                setPasswordForm({ ...passwordForm, newPassword: e.target.value })
              }
              className="mt-1"
              placeholder={t('placeholders.newPassword')}
            />
          </div>

          <div>
            <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) =>
                setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })
              }
              className="mt-1"
              placeholder={t('placeholders.confirmPassword')}
            />
          </div>

          <div className="pt-2">
            <Button
              onClick={handleChangePassword}
              disabled={isChangingPassword}
              isLoading={isChangingPassword}
            >
              {t('changePassword')}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            {t('passwordRequirements')}
          </p>
        </div>
      </Card>
    </div>
  );
}
