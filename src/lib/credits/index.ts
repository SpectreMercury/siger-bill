/**
 * Credits Module (Phase 3.3)
 *
 * Exports credit-related functionality for invoice billing.
 */

export {
  loadApplicableCredits,
  applyCreditsToInvoice,
  captureCreditConfigSnapshot,
  getCustomerCreditSummary,
  type CreditForApplication,
  type CreditApplicationEntry,
  type CreditApplicationResult,
  type CreditConfigSnapshot,
} from './engine';
