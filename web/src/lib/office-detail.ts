import type { WorldTierEntityCaps, WorldUnlockFlags } from "@/lib/world-tier-config";
import { resolveWorldTierConfig } from "@/lib/world-tier-config";

const BASE_WORLD_CAPS = resolveWorldTierConfig(0).caps;
const DETAIL_PROP_SLOT_COUNT = 5;

export interface ResolveOfficeDetailVisibilityOptions {
  unlocks: WorldUnlockFlags;
  caps: WorldTierEntityCaps;
  experimentalDecorationsEnabled: boolean;
  totalPlantSlots: number;
}

export interface OfficeDetailVisibility {
  showDetailDecorations: boolean;
  visiblePlantCount: number;
  visibleDetailPropCount: number;
}

export function resolveOfficeDetailVisibility(
  options: ResolveOfficeDetailVisibilityOptions
): OfficeDetailVisibility {
  const showDetailDecorations =
    options.unlocks.officeDetail && options.experimentalDecorationsEnabled;
  const visiblePlantCap = showDetailDecorations
    ? options.caps.maxOfficePlants
    : BASE_WORLD_CAPS.maxOfficePlants;

  const visiblePlantCount = Math.max(
    0,
    Math.min(options.totalPlantSlots, Math.floor(visiblePlantCap))
  );

  const detailPropBudget = showDetailDecorations
    ? Math.max(
        0,
        Math.floor(options.caps.maxOfficeProps - BASE_WORLD_CAPS.maxOfficeProps)
      )
    : 0;

  return {
    showDetailDecorations,
    visiblePlantCount,
    visibleDetailPropCount: Math.min(DETAIL_PROP_SLOT_COUNT, detailPropBudget),
  };
}
