'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  ApiError,
  api,
  isAuthenticated as hasStoredAuthToken,
  logout as apiLogout,
  clearAuthToken,
} from '@/lib/client/api';
import { User } from '@/lib/client/types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  authError: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  hasPermission: (resource: string, action: string) => boolean;
  hasCustomerScope: (customerId: string) => boolean;
  hasRole: (role: string) => boolean;
  isSuperAdmin: boolean;
  isFinance: boolean;
  isAdmin: boolean;
  scopedCustomerIds: string[];
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    if (!hasStoredAuthToken()) {
      setUser(null);
      setAuthError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setAuthError(null);
    try {
      const response = await api.get<{ user: User }>('/me');
      setUser(response.user);
      setAuthError(null);
    } catch (error) {
      const isExpectedAuthFailure =
        error instanceof ApiError &&
        (error.status === 401 || error.code === 'AUTH_REQUIRED');
      if (!isExpectedAuthFailure) {
        console.error('Failed to fetch user:', error);
        setAuthError(error instanceof Error ? error.message : 'Unable to verify your session');
      }
      if (isExpectedAuthFailure) {
        clearAuthToken();
        setUser(null);
        setAuthError(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const { login: apiLogin } = await import('@/lib/client/api');
    setIsLoading(true);
    setAuthError(null);
    try {
      await apiLogin(email, password);
      await refreshUser();
    } catch (error) {
      clearAuthToken();
      setUser(null);
      setAuthError(null);
      setIsLoading(false);
      throw error;
    }
  }, [refreshUser]);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
    setAuthError(null);
  }, []);

  const hasPermission = useCallback(
    (resource: string, action: string): boolean => {
      if (!user) return false;
      if (user.isSuperAdmin) return true;
      return (user.permissions ?? []).includes(`${resource}:${action}`);
    },
    [user]
  );

  const hasCustomerScope = useCallback(
    (customerId: string): boolean => {
      if (!user) return false;
      if (user.isSuperAdmin) return true;
      return (user.scopes ?? []).some(
        (scope) => scope.scopeType === 'CUSTOMER' && scope.scopeId === customerId
      );
    },
    [user]
  );

  const hasRole = useCallback(
    (role: string): boolean => {
      if (!user) return false;
      return (user.roles ?? []).includes(role);
    },
    [user]
  );

  const isSuperAdmin = user?.isSuperAdmin ?? false;
  const isFinance = hasRole('finance') || isSuperAdmin;
  const isAdmin = hasRole('admin') || isSuperAdmin;
  const effectiveIsLoading = isLoading;

  const scopedCustomerIds = (user?.scopes ?? [])
    .filter((s) => s.scopeType === 'CUSTOMER')
    .map((s) => s.scopeId);

  const value: AuthContextValue = {
    user,
    isLoading: effectiveIsLoading,
    authError,
    isAuthenticated: !!user,
    login,
    logout,
    refreshUser,
    hasPermission,
    hasCustomerScope,
    hasRole,
    isSuperAdmin,
    isFinance,
    isAdmin,
    scopedCustomerIds,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Hook to get current user - returns null if not authenticated
 */
export function useMe(): User | null {
  const { user } = useAuth();
  return user;
}
