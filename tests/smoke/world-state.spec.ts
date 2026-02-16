import { expect, test } from "@playwright/test";
import type { PrototypeInstallCountSnapshot } from "../../web/src/lib/install-count-core";
import {
  buildWorldStatePayload,
  resolveTierForInstallCount,
  resolveWorldInstallSignal,
} from "../../web/src/lib/world-state-core";

test("world-state payload is deterministic for prototype install source", () => {
  const prototypeSnapshot: PrototypeInstallCountSnapshot = {
    installCount: 133,
    releaseCount: 4,
    installerAssetCount: 4,
    checkedAt: "2026-02-16T00:00:00.000Z",
    source: "github_release_assets",
  };

  const signal = resolveWorldInstallSignal(prototypeSnapshot, {
    preferredSource: "prototype",
  });

  const first = buildWorldStatePayload(signal);
  const second = buildWorldStatePayload(signal);

  expect(first).toEqual(second);
  expect(first).toEqual({
    schemaVersion: "2026-02-16.world-state.v1",
    generatedAt: "2026-02-16T00:00:00.000Z",
    installCount: 133,
    tier: {
      level: 2,
      key: "tier_2_office_detail",
      minInstallCount: 100,
      nextInstallCount: 250,
    },
    unlocks: {
      agentsAndDesks: true,
      officeDetail: true,
      exteriorPark: false,
      blueSky: false,
      worldRichness: false,
    },
    installSource: {
      kind: "prototype",
      name: "github_release_assets",
      detail: "github_release_assets",
    },
    versions: {
      worldState: "2026-02-16.world-state.v1",
      tierConfig: "prototype-v1",
    },
  });
});

test("world-state can use production install source when configured", () => {
  const prototypeSnapshot: PrototypeInstallCountSnapshot = {
    installCount: 133,
    releaseCount: 4,
    installerAssetCount: 4,
    checkedAt: "2026-02-16T00:00:00.000Z",
    source: "github_release_assets",
  };

  const signal = resolveWorldInstallSignal(prototypeSnapshot, {
    preferredSource: "production",
    productionInstallCount: 525,
    checkedAt: "2026-02-16T01:00:00.000Z",
  });
  const payload = buildWorldStatePayload(signal);

  expect(payload.installSource).toEqual({
    kind: "production",
    name: "install_beacon_aggregate",
    detail: "aggregated_unique_installations",
  });
  expect(payload.installCount).toBe(525);
  expect(payload.tier).toEqual({
    level: 4,
    key: "tier_4_world_richness",
    minInstallCount: 500,
    nextInstallCount: null,
  });
  expect(payload.unlocks.worldRichness).toBe(true);
  expect(payload.unlocks.exteriorPark).toBe(true);
});

test("production preference falls back to prototype source when value is missing", () => {
  const prototypeSnapshot: PrototypeInstallCountSnapshot = {
    installCount: 72,
    releaseCount: 3,
    installerAssetCount: 3,
    checkedAt: "2026-02-16T00:00:00.000Z",
    source: "fallback_last_known",
  };

  const signal = resolveWorldInstallSignal(prototypeSnapshot, {
    preferredSource: "production",
    productionInstallCount: null,
    checkedAt: "2026-02-16T01:00:00.000Z",
  });

  expect(signal).toEqual({
    count: 72,
    checkedAt: "2026-02-16T00:00:00.000Z",
    sourceKind: "prototype",
    sourceName: "github_release_assets",
    sourceDetail: "fallback_last_known",
  });
});

test("tier resolver clamps negative install counts to base tier", () => {
  expect(resolveTierForInstallCount(-5)).toEqual({
    level: 0,
    key: "base",
    minInstallCount: 0,
    nextInstallCount: 25,
  });
});
