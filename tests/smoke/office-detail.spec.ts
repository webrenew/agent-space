import { expect, test } from "@playwright/test";
import { resolveOfficeDetailVisibility } from "../../web/src/lib/office-detail";
import { resolveWorldTierConfig } from "../../web/src/lib/world-tier-config";

test("tier 1 keeps baseline office decorations without detail props", () => {
  const tier1 = resolveWorldTierConfig(25);
  const visibility = resolveOfficeDetailVisibility({
    unlocks: tier1.unlocks,
    caps: tier1.caps,
    experimentalDecorationsEnabled: true,
    totalPlantSlots: 16,
  });

  expect(visibility).toEqual({
    showDetailDecorations: false,
    visiblePlantCount: 10,
    visibleDetailPropCount: 0,
  });
});

test("tier 2 enables richer office detail when experimental decor is on", () => {
  const tier2 = resolveWorldTierConfig(100);
  const visibility = resolveOfficeDetailVisibility({
    unlocks: tier2.unlocks,
    caps: tier2.caps,
    experimentalDecorationsEnabled: true,
    totalPlantSlots: 16,
  });

  expect(visibility).toEqual({
    showDetailDecorations: true,
    visiblePlantCount: 16,
    visibleDetailPropCount: 5,
  });
});

test("detail props are disabled immediately when experimental decor is off", () => {
  const tier2 = resolveWorldTierConfig(100);
  const visibility = resolveOfficeDetailVisibility({
    unlocks: tier2.unlocks,
    caps: tier2.caps,
    experimentalDecorationsEnabled: false,
    totalPlantSlots: 16,
  });

  expect(visibility).toEqual({
    showDetailDecorations: false,
    visiblePlantCount: 10,
    visibleDetailPropCount: 0,
  });
});
