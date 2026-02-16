import { expect, test } from "@playwright/test";
import { resolveOfficeDeskLayout } from "../../web/src/lib/office-layout";
import { resolveWorldTierConfig } from "../../web/src/lib/world-tier-config";

function serializeDeskPositions(desks: Array<{ position: [number, number, number] }>): string {
  return desks
    .map((desk) => `${desk.position[0]},${desk.position[2]}`)
    .join(" | ");
}

test("tier 0 and tier 1 desk layouts match visual QA baselines", () => {
  const tier0Desks = resolveOfficeDeskLayout(resolveWorldTierConfig(0).caps.maxDesks);
  const tier1Desks = resolveOfficeDeskLayout(resolveWorldTierConfig(25).caps.maxDesks);

  expect(serializeDeskPositions(tier0Desks)).toBe("-3,-4 | 3,-4 | -3,-8 | 3,-8");
  expect(serializeDeskPositions(tier1Desks)).toBe(
    "-3,-4 | 3,-4 | -3,-8 | 3,-8 | -7,-4 | 7,-4 | -7,-8 | 7,-8"
  );
});

test("tier 1 desk layout keeps deterministic non-overlapping spacing", () => {
  const tier1Desks = resolveOfficeDeskLayout(resolveWorldTierConfig(25).caps.maxDesks);
  const occupied = tier1Desks.map((desk) => desk.position);

  for (let i = 0; i < occupied.length; i += 1) {
    for (let j = i + 1; j < occupied.length; j += 1) {
      const dx = occupied[i][0] - occupied[j][0];
      const dz = occupied[i][2] - occupied[j][2];
      const distance = Math.hypot(dx, dz);
      expect(distance).toBeGreaterThan(2.4);
    }
  }
});
