/**
 * Preset options for ProjectBillingConfig.name (the business-side display name
 * shown next to each project in the customer-binding UI).
 *
 * TODO(user): fill this list with the canonical project name options.
 * The drawer/registry UI will render this as a dropdown; raw free-text is not
 * allowed at the app layer (the DB column is technically nullable for backfill
 * cases, but the UI enforces selection from this list).
 *
 * Example:
 *   export const PROJECT_NAME_OPTIONS = [
 *     '生产环境',
 *     '测试环境',
 *     'AI 训练',
 *     // ...
 *   ] as const;
 */

export const PROJECT_NAME_OPTIONS: readonly string[] = [
  // TODO: populate
];

export type ProjectNameOption = (typeof PROJECT_NAME_OPTIONS)[number];

/** Convenience: whether the catalog has any options yet (drives empty-state UX). */
export const HAS_PROJECT_NAME_OPTIONS = PROJECT_NAME_OPTIONS.length > 0;
