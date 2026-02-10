/*
  Warnings:

  - You are about to drop the column `adjustment_total` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the column `credit_total` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the column `discount_total` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the column `invoice_amount` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the column `line_items` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the column `raw_cost_total` on the `invoices` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED', 'LOCKED');

-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "adjustment_total",
DROP COLUMN "credit_total",
DROP COLUMN "discount_total",
DROP COLUMN "invoice_amount",
DROP COLUMN "line_items",
DROP COLUMN "raw_cost_total",
ADD COLUMN     "due_date" DATE,
ADD COLUMN     "issue_date" DATE,
ADD COLUMN     "paid_at" TIMESTAMPTZ,
ADD COLUMN     "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "total_amount" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL,
    "unit_price" DECIMAL(18,10) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_line_items_invoice_id_line_number_key" ON "invoice_line_items"("invoice_id", "line_number");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
