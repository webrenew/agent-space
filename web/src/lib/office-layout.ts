export interface OfficeDeskLayoutEntry {
  position: [number, number, number];
  rotation: [number, number, number];
  facing: [number, number, number];
}

const DESK_POSITION_ORDER: Array<[number, number]> = [
  [-3, -4],
  [3, -4],
  [-3, -8],
  [3, -8],
  [-7, -4],
  [7, -4],
  [-7, -8],
  [7, -8],
  [-3, 0],
  [3, 0],
  [-7, 0],
  [7, 0],
  [-3, -12],
  [3, -12],
];

export const OFFICE_DESK_LAYOUT: readonly OfficeDeskLayoutEntry[] =
  DESK_POSITION_ORDER.map(([x, z]) => ({
    position: [x, 0, z],
    rotation: [0, Math.PI, 0],
    facing: [x, 0, z - 0.8],
  }));

export function resolveOfficeDeskLayout(maxDesks: number): OfficeDeskLayoutEntry[] {
  const safeDeskCount = Number.isFinite(maxDesks) ? Math.floor(maxDesks) : 0;
  const clampedDeskCount = Math.max(0, Math.min(OFFICE_DESK_LAYOUT.length, safeDeskCount));
  return OFFICE_DESK_LAYOUT.slice(0, clampedDeskCount).map((entry) => ({
    position: [...entry.position] as [number, number, number],
    rotation: [...entry.rotation] as [number, number, number],
    facing: [...entry.facing] as [number, number, number],
  }));
}
