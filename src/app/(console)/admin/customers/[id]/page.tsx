'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client/api';
import { Customer } from '@/lib/client/types';
import { Alert, StatusBadge } from '@/components/ui';
import { Button } from '@/components/ui/shadcn/button';
import { Card } from '@/components/ui/shadcn/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { Can } from '@/components/auth';
import { ArrowLeft, Loader2, Pencil } from 'lucide-react';
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
import { CustomerProjectsTab } from '@/components/admin/CustomerProjectsTab';
import { CustomerPricingTab } from '@/components/admin/CustomerPricingTab';
import { CustomerCreditsTab } from '@/components/admin/CustomerCreditsTab';
import { CustomerInvoicesTab } from '@/components/admin/CustomerInvoicesTab';

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    externalId: '',
    currency: 'USD',
    paymentTermsDays: 30,
    primaryContactEmail: '',
    status: 'ACTIVE' as 'ACTIVE' | 'SUSPENDED' | 'TERMINATED',
  });

  const fetchCustomer = useCallback(async () => {
    if (!customerId) return;
    setIsLoading(true);
    setError(null);

    try {
      const response = await api.get<Customer>(`/customers/${customerId}`);
      setCustomer(response);
    } catch (err) {
      console.error('Error fetching customer:', err);
      setError('Failed to load customer');
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  const handleEdit = () => {
    if (!customer) return;
    setFormData({
      name: customer.name,
      externalId: customer.externalId || '',
      currency: customer.currency,
      paymentTermsDays: customer.paymentTermsDays,
      primaryContactEmail: customer.primaryContactEmail || '',
      status: customer.status,
    });
    setShowEditModal(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      await api.put(`/customers/${customerId}`, formData);
      setShowEditModal(false);
      fetchCustomer();
    } catch (err) {
      console.error('Error saving customer:', err);
      setError('Failed to save customer');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Alert variant="error">{error || 'Customer not found'}</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin/customers">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
      </div>

      {/* Customer Info Card */}
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{customer.name}</h1>
              <StatusBadge status={customer.status} />
            </div>
            {customer.externalId && (
              <p className="text-muted-foreground text-sm mt-1">{customer.externalId}</p>
            )}
          </div>
          <Can resource="customers" action="update">
            <Button variant="secondary" onClick={handleEdit}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit Customer
            </Button>
          </Can>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div>
            <p className="text-sm text-muted-foreground">Currency</p>
            <p className="font-medium">{customer.currency}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Payment Terms</p>
            <p className="font-medium">{customer.paymentTermsDays} days</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Contact Email</p>
            <p className="font-medium">{customer.primaryContactEmail || '-'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Created</p>
            <p className="font-medium">
              {new Date(customer.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="projects" className="space-y-4">
        <TabsList>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="projects">
          <CustomerProjectsTab customerId={customerId} />
        </TabsContent>

        <TabsContent value="pricing">
          <CustomerPricingTab customerId={customerId} />
        </TabsContent>

        <TabsContent value="credits">
          <CustomerCreditsTab customerId={customerId} />
        </TabsContent>

        <TabsContent value="invoices">
          <CustomerInvoicesTab customerId={customerId} />
        </TabsContent>
      </Tabs>

      {/* Edit Customer Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Customer"
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
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="externalId">External ID</Label>
            <Input
              id="externalId"
              type="text"
              value={formData.externalId}
              onChange={(e) => setFormData({ ...formData, externalId: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select
                value={formData.currency}
                onValueChange={(value) => setFormData({ ...formData, currency: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                  <SelectItem value="JPY">JPY</SelectItem>
                  <SelectItem value="CNY">CNY</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentTerms">Payment Terms (days)</Label>
              <Input
                id="paymentTerms"
                type="number"
                value={formData.paymentTermsDays}
                onChange={(e) =>
                  setFormData({ ...formData, paymentTermsDays: parseInt(e.target.value) || 30 })
                }
                min={1}
                max={180}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contactEmail">Primary Contact Email</Label>
            <Input
              id="contactEmail"
              type="email"
              value={formData.primaryContactEmail}
              onChange={(e) => setFormData({ ...formData, primaryContactEmail: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select
              value={formData.status}
              onValueChange={(value: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED') => setFormData({ ...formData, status: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="SUSPENDED">Suspended</SelectItem>
                <SelectItem value="TERMINATED">Terminated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
