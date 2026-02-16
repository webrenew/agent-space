import type { PrototypeInstallCountSnapshot } from "@/lib/install-count-core";

export const WORLD_STATE_SCHEMA_VERSION = "2026-02-16.world-state.v1";
export const WORLD_TIER_CONFIG_VERSION = "prototype-v1";

export type WorldInstallSourceKind = "prototype" | "production";
export type WorldInstallSourceName =
  | "github_release_assets"
  | "install_beacon_aggregate";

export interface WorldInstallSignal {
  count: number;
  checkedAt: string;
  sourceKind: WorldInstallSourceKind;
  sourceName: WorldInstallSourceName;
  sourceDetail: string;
}

export interface ResolveWorldInstallSignalOptions {
  preferredSource?: WorldInstallSourceKind;
  productionInstallCount?: number | null;
  checkedAt?: string;
}

export interface WorldUnlockFlags {
  agentsAndDesks: boolean;
  officeDetail: boolean;
  exteriorPark: boolean;
  blueSky: boolean;
  worldRichness: boolean;
}

interface WorldTierDefinition {
  level: number;
  key: string;
  minInstallCount: number;
  unlocks: WorldUnlockFlags;
}

interface ResolvedWorldTier extends WorldTierDefinition {
  nextInstallCount: number | null;
}

export interface WorldTierState {
  level: number;
  key: string;
  minInstallCount: number;
  nextInstallCount: number | null;
}

export interface WorldStatePayload {
  schemaVersion: string;
  generatedAt: string;
  installCount: number;
  tier: WorldTierState;
  unlocks: WorldUnlockFlags;
  installSource: {
    kind: WorldInstallSourceKind;
    name: WorldInstallSourceName;
    detail: string;
  };
  versions: {
    worldState: string;
    tierConfig: string;
  };
}

const WORLD_TIERS: readonly WorldTierDefinition[] = [
  {
    level: 0,
    key: "base",
    minInstallCount: 0,
    unlocks: {
      agentsAndDesks: false,
      officeDetail: false,
      exteriorPark: false,
      blueSky: false,
      worldRichness: false,
    },
  },
  {
    level: 1,
    key: "tier_1_density",
    minInstallCount: 25,
    unlocks: {
      agentsAndDesks: true,
      officeDetail: false,
      exteriorPark: false,
      blueSky: false,
      worldRichness: false,
    },
  },
  {
    level: 2,
    key: "tier_2_office_detail",
    minInstallCount: 100,
    unlocks: {
      agentsAndDesks: true,
      officeDetail: true,
      exteriorPark: false,
      blueSky: false,
      worldRichness: false,
    },
  },
  {
    level: 3,
    key: "tier_3_exterior",
    minInstallCount: 250,
    unlocks: {
      agentsAndDesks: true,
      officeDetail: true,
      exteriorPark: true,
      blueSky: true,
      worldRichness: false,
    },
  },
  {
    level: 4,
    key: "tier_4_world_richness",
    minInstallCount: 500,
    unlocks: {
      agentsAndDesks: true,
      officeDetail: true,
      exteriorPark: true,
      blueSky: true,
      worldRichness: true,
    },
  },
];

function normalizeInstallCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function resolveTier(installCount: number): ResolvedWorldTier {
  const normalizedCount = normalizeInstallCount(installCount);
  let tierIndex = 0;

  for (let index = 1; index < WORLD_TIERS.length; index += 1) {
    const candidate = WORLD_TIERS[index];
    if (normalizedCount >= candidate.minInstallCount) {
      tierIndex = index;
      continue;
    }
    break;
  }

  const current = WORLD_TIERS[tierIndex];
  const next = WORLD_TIERS[tierIndex + 1];
  return {
    ...current,
    unlocks: { ...current.unlocks },
    nextInstallCount: next?.minInstallCount ?? null,
  };
}

export function resolveTierForInstallCount(installCount: number): WorldTierState {
  const tier = resolveTier(installCount);
  return {
    level: tier.level,
    key: tier.key,
    minInstallCount: tier.minInstallCount,
    nextInstallCount: tier.nextInstallCount,
  };
}

export function resolveWorldInstallSignal(
  prototypeSnapshot: PrototypeInstallCountSnapshot,
  options: ResolveWorldInstallSignalOptions = {}
): WorldInstallSignal {
  const preferredSource = options.preferredSource ?? "prototype";
  const productionInstallCount =
    typeof options.productionInstallCount === "number" &&
    Number.isFinite(options.productionInstallCount) &&
    options.productionInstallCount >= 0
      ? Math.floor(options.productionInstallCount)
      : null;

  if (preferredSource === "production" && productionInstallCount !== null) {
    return {
      count: productionInstallCount,
      checkedAt: options.checkedAt ?? new Date().toISOString(),
      sourceKind: "production",
      sourceName: "install_beacon_aggregate",
      sourceDetail: "aggregated_unique_installations",
    };
  }

  return {
    count: normalizeInstallCount(prototypeSnapshot.installCount),
    checkedAt: prototypeSnapshot.checkedAt,
    sourceKind: "prototype",
    sourceName: "github_release_assets",
    sourceDetail: prototypeSnapshot.source,
  };
}

export function buildWorldStatePayload(signal: WorldInstallSignal): WorldStatePayload {
  const installCount = normalizeInstallCount(signal.count);
  const tier = resolveTier(installCount);

  return {
    schemaVersion: WORLD_STATE_SCHEMA_VERSION,
    generatedAt: signal.checkedAt,
    installCount,
    tier: {
      level: tier.level,
      key: tier.key,
      minInstallCount: tier.minInstallCount,
      nextInstallCount: tier.nextInstallCount,
    },
    unlocks: { ...tier.unlocks },
    installSource: {
      kind: signal.sourceKind,
      name: signal.sourceName,
      detail: signal.sourceDetail,
    },
    versions: {
      worldState: WORLD_STATE_SCHEMA_VERSION,
      tierConfig: WORLD_TIER_CONFIG_VERSION,
    },
  };
}
