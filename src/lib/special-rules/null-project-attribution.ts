export type NullProjectAttributionMapping = {
  ruleId: string;
  ruleName: string;
  billingAccountId: string;
  skuId: string;
  projectId: string;
  targetCustomerId?: string;
};

export type NullProjectAttributionLine = {
  billingAccountId: string;
  skuId: string;
  projectId: string | null;
};

export type NullProjectAttributionResolution = {
  ruleId: string;
  ruleName: string;
  projectId: string;
  targetCustomerId?: string;
};

export type NullProjectAttributionConfigItem = {
  billingAccountId: string;
  skuIds: string[];
  projectId: string;
};

export type FlatNullProjectAttributionConfigItem = {
  billingAccountId: string;
  skuId: string;
  projectId: string;
};

export type NullProjectAttributionReferences = {
  billingAccountIds: string[];
  projects: Array<{
    projectId: string;
    billable: boolean;
    activeCustomerIds: string[];
  }>;
  existingMappings?: NullProjectAttributionMapping[];
};

export type NullProjectAttributionPlan = {
  mappings: NullProjectAttributionMapping[];
  resolve(line: NullProjectAttributionLine): NullProjectAttributionResolution | null;
};

export class NullProjectAttributionConfigError extends Error {
  code = 'ATTRIBUTION_CONFIG_INVALID' as const;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'NullProjectAttributionConfigError';
  }
}

export class NullProjectAttributionConflictError extends NullProjectAttributionConfigError {
  constructor(billingAccountId: string, skuId: string) {
    super(`Conflicting null-project attribution for Billing ID ${billingAccountId} and SKU ${skuId}`);
    this.name = 'NullProjectAttributionConflictError';
  }
}

function mappingKey(billingAccountId: string, skuId: string): string {
  return `${billingAccountId.trim().toUpperCase()}\u0000${skuId.trim()}`;
}

export function normalizeNullProjectAttributionConfig(
  config: NullProjectAttributionConfigItem[]
): NullProjectAttributionConfigItem[] {
  return config.map((item) => ({
    billingAccountId: item.billingAccountId.trim().toUpperCase(),
    skuIds: Array.from(new Set(item.skuIds.map((skuId) => skuId.trim()))),
    projectId: item.projectId.trim(),
  }));
}

export function flattenNullProjectAttributionConfig(
  config: NullProjectAttributionConfigItem[]
): FlatNullProjectAttributionConfigItem[] {
  return normalizeNullProjectAttributionConfig(config).flatMap((item) =>
    item.skuIds.map((skuId) => ({
      billingAccountId: item.billingAccountId,
      skuId,
      projectId: item.projectId,
    }))
  );
}

export function groupNullProjectAttributionMappings(
  mappings: FlatNullProjectAttributionConfigItem[]
): NullProjectAttributionConfigItem[] {
  const groups = new Map<string, NullProjectAttributionConfigItem>();
  for (const mapping of mappings) {
    const billingAccountId = mapping.billingAccountId.trim().toUpperCase();
    const projectId = mapping.projectId.trim();
    const key = `${billingAccountId}\u0000${projectId}`;
    const group = groups.get(key) ?? { billingAccountId, skuIds: [], projectId };
    group.skuIds.push(mapping.skuId.trim());
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      skuIds: Array.from(new Set(group.skuIds)).sort(),
    }))
    .sort((left, right) => (
      left.billingAccountId.localeCompare(right.billingAccountId)
      || left.projectId.localeCompare(right.projectId)
    ));
}

export function validateNullProjectAttributionConfig(
  config: NullProjectAttributionConfigItem[],
  references: NullProjectAttributionReferences
): FlatNullProjectAttributionConfigItem[] {
  const flattened = flattenNullProjectAttributionConfig(config);
  const candidateByKey = new Map<string, FlatNullProjectAttributionConfigItem>();
  for (const mapping of flattened) {
    const key = mappingKey(mapping.billingAccountId, mapping.skuId);
    const existing = candidateByKey.get(key);
    if (existing && existing.projectId !== mapping.projectId) {
      throw new NullProjectAttributionConflictError(mapping.billingAccountId, mapping.skuId);
    }
    if (!existing) candidateByKey.set(key, mapping);
  }
  const deduplicated = Array.from(candidateByKey.values());
  const registeredBillingAccountIds = new Set(
    references.billingAccountIds.map((billingAccountId) => billingAccountId.trim().toUpperCase())
  );
  const projectById = new Map(
    references.projects.map((project) => [project.projectId, project])
  );
  for (const mapping of deduplicated) {
    if (!registeredBillingAccountIds.has(mapping.billingAccountId)) {
      throw new NullProjectAttributionConfigError(
        `Billing ID ${mapping.billingAccountId} is not registered`
      );
    }
    const project = projectById.get(mapping.projectId);
    if (!project) {
      throw new NullProjectAttributionConfigError(
        `Project ${mapping.projectId} is not registered`
      );
    }
    if (!project.billable) {
      throw new NullProjectAttributionConfigError(
        `Project ${mapping.projectId} must be billable`
      );
    }
    if (project.activeCustomerIds.length !== 1) {
      throw new NullProjectAttributionConfigError(
        `Project ${mapping.projectId} must have exactly one active customer binding`
      );
    }
  }
  buildNullProjectAttributionPlan([
    ...(references.existingMappings ?? []),
    ...deduplicated.map((mapping) => ({
      ...mapping,
      ruleId: 'candidate-rule',
      ruleName: 'Candidate rule',
    })),
  ]);
  return deduplicated;
}

export function buildNullProjectAttributionPlan(
  mappings: NullProjectAttributionMapping[]
): NullProjectAttributionPlan {
  const mappingByKey = new Map<string, NullProjectAttributionMapping>();
  for (const mapping of mappings) {
    const normalizedMapping = {
      ...mapping,
      billingAccountId: mapping.billingAccountId.trim().toUpperCase(),
      skuId: mapping.skuId.trim(),
      projectId: mapping.projectId.trim(),
    };
    const key = mappingKey(normalizedMapping.billingAccountId, normalizedMapping.skuId);
    const existing = mappingByKey.get(key);
    if (existing) {
      if (existing.projectId !== normalizedMapping.projectId) {
        throw new NullProjectAttributionConflictError(
          normalizedMapping.billingAccountId,
          normalizedMapping.skuId
        );
      }
      continue;
    }
    mappingByKey.set(key, normalizedMapping);
  }

  return {
    mappings: Array.from(mappingByKey.values()).sort((left, right) => (
      left.billingAccountId.localeCompare(right.billingAccountId)
      || left.skuId.localeCompare(right.skuId)
      || left.projectId.localeCompare(right.projectId)
    )),
    resolve(line) {
      if (line.projectId !== null) return null;
      const mapping = mappingByKey.get(mappingKey(line.billingAccountId, line.skuId));
      if (!mapping) return null;
      return {
        ruleId: mapping.ruleId,
        ruleName: mapping.ruleName,
        projectId: mapping.projectId,
        ...(mapping.targetCustomerId
          ? { targetCustomerId: mapping.targetCustomerId }
          : {}),
      };
    },
  };
}
