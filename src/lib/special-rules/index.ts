/**
 * Special Rules Module (Phase 3.5)
 *
 * Exports special rules functionality for invoice billing.
 */

export {
  loadApplicableSpecialRules,
  applySpecialRules,
  recordSpecialRuleEffects,
  captureSpecialRulesConfigSnapshot,
  attachSkuGroupsToEntries,
  type CostEntryForRules,
  type LoadedSpecialRule,
  type RuleApplicationResult,
  type SpecialRulesApplicationResult,
  type SpecialRuleConfigSnapshot,
} from './engine';
