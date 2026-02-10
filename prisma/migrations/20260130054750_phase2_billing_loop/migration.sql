/*
  Warnings:

  - Added the required column `billing_month` to the `invoices` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "billing_account_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'NOT_FOUND', 'NO_BILLING');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'IMPORT';
ALTER TYPE "audit_action" ADD VALUE 'BIND';
ALTER TYPE "audit_action" ADD VALUE 'UNBIND';

-- DropIndex
DROP INDEX "invoice_runs_billing_month_status_key";

-- AlterTable
ALTER TABLE "invoice_runs" ADD COLUMN     "source_ingestion_batch_ids" UUID[],
ADD COLUMN     "source_time_range_end" TIMESTAMPTZ,
ADD COLUMN     "source_time_range_start" TIMESTAMPTZ,
ADD COLUMN     "target_customer_id" UUID;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "billing_month" VARCHAR(7) NOT NULL,
ADD COLUMN     "currency_breakdown" JSONB,
ALTER COLUMN "currency" SET DATA TYPE VARCHAR(10);

-- CreateTable
CREATE TABLE "billing_accounts" (
    "id" UUID NOT NULL,
    "billing_account_id" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255),
    "status" "billing_account_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "project_id" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255),
    "status" "project_status" NOT NULL DEFAULT 'ACTIVE',
    "billing_account_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_projects" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_cost_ingestion_batches" (
    "id" UUID NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "month" VARCHAR(7),
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "checksum" VARCHAR(64),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_cost_ingestion_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_cost_entries" (
    "id" UUID NOT NULL,
    "ingestion_batch_id" UUID NOT NULL,
    "billing_account_id" VARCHAR(100) NOT NULL,
    "project_id" VARCHAR(100) NOT NULL,
    "service_id" VARCHAR(100) NOT NULL,
    "sku_id" VARCHAR(100) NOT NULL,
    "usage_start_time" TIMESTAMPTZ NOT NULL,
    "usage_end_time" TIMESTAMPTZ NOT NULL,
    "usage_amount" DECIMAL(24,10) NOT NULL,
    "cost" DECIMAL(18,10) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "region" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounts_billing_account_id_key" ON "billing_accounts"("billing_account_id");

-- CreateIndex
CREATE INDEX "billing_accounts_billing_account_id_idx" ON "billing_accounts"("billing_account_id");

-- CreateIndex
CREATE INDEX "billing_accounts_status_idx" ON "billing_accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_project_id_key" ON "projects"("project_id");

-- CreateIndex
CREATE INDEX "projects_project_id_idx" ON "projects"("project_id");

-- CreateIndex
CREATE INDEX "projects_billing_account_id_idx" ON "projects"("billing_account_id");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "customer_projects_customer_id_is_active_idx" ON "customer_projects"("customer_id", "is_active");

-- CreateIndex
CREATE INDEX "customer_projects_project_id_is_active_idx" ON "customer_projects"("project_id", "is_active");

-- CreateIndex
CREATE INDEX "customer_projects_start_date_end_date_idx" ON "customer_projects"("start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "customer_projects_customer_id_project_id_start_date_key" ON "customer_projects"("customer_id", "project_id", "start_date");

-- CreateIndex
CREATE INDEX "raw_cost_ingestion_batches_month_idx" ON "raw_cost_ingestion_batches"("month");

-- CreateIndex
CREATE INDEX "raw_cost_ingestion_batches_created_by_idx" ON "raw_cost_ingestion_batches"("created_by");

-- CreateIndex
CREATE INDEX "raw_cost_ingestion_batches_created_at_idx" ON "raw_cost_ingestion_batches"("created_at");

-- CreateIndex
CREATE INDEX "raw_cost_entries_project_id_usage_start_time_idx" ON "raw_cost_entries"("project_id", "usage_start_time");

-- CreateIndex
CREATE INDEX "raw_cost_entries_ingestion_batch_id_idx" ON "raw_cost_entries"("ingestion_batch_id");

-- CreateIndex
CREATE INDEX "raw_cost_entries_billing_account_id_usage_start_time_idx" ON "raw_cost_entries"("billing_account_id", "usage_start_time");

-- CreateIndex
CREATE INDEX "raw_cost_entries_usage_start_time_usage_end_time_idx" ON "raw_cost_entries"("usage_start_time", "usage_end_time");

-- CreateIndex
CREATE INDEX "invoice_runs_target_customer_id_idx" ON "invoice_runs"("target_customer_id");

-- CreateIndex
CREATE INDEX "invoices_billing_month_idx" ON "invoices"("billing_month");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_projects" ADD CONSTRAINT "customer_projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_projects" ADD CONSTRAINT "customer_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_cost_ingestion_batches" ADD CONSTRAINT "raw_cost_ingestion_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_cost_entries" ADD CONSTRAINT "raw_cost_entries_ingestion_batch_id_fkey" FOREIGN KEY ("ingestion_batch_id") REFERENCES "raw_cost_ingestion_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
