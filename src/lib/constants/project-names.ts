/**
 * Suggested options for ProjectBillingConfig.name (the business-side display
 * name shown next to each project).
 *
 * These are NOT enforced — the UI renders a free-text input and these values
 * are exposed via an HTML `<datalist>` purely as autocomplete suggestions.
 * The user is free to type any value, leave it blank, or pick a suggestion.
 *
 * Populate with the canonical project name options if desired:
 *   export const PROJECT_NAME_OPTIONS = [
 *     '生产环境',
 *     '测试环境',
 *     'AI 训练',
 *   ] as const;
 */

export const PROJECT_NAME_OPTIONS: readonly string[] = [
  // Add suggestions here; users can still type anything not on this list.
];
