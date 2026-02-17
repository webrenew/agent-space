"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { AmbientLight, DirectionalLight, InstancedMesh, MeshStandardMaterial, PointLight } from "three";
import { Color, MathUtils, Object3D } from "three";
import { useDemoStore } from "@/stores/useDemoStore";
import { AgentCharacter } from "./AgentCharacter";
import { CelebrationEffect } from "./CelebrationEffect";
import type { AgentStatus } from "@/types";
import { resolveWorldTierConfig } from "@/lib/world-tier-config";
import { resolveOfficeDeskLayout } from "@/lib/office-layout";
import { resolveOfficeDetailVisibility } from "@/lib/office-detail";
import { resolveExteriorVisibility } from "@/lib/exterior-detail";
import { resolveDistanceCulledItems } from "@/lib/scene-culling";
import { NON_CRITICAL_CULL_DISTANCE } from "@/lib/world-performance";

const WALL_COLOR = "#E8E0D8";
const FLOOR_COLOR = "#D4A574";
const DESK_COLOR = "#8B6914";
const MONITOR_COLOR = "#1A1A2E";
const BACK_WINDOW_POSITIONS = [-7.2, -2.4, 2.4, 7.2] as const;
const SIDE_WINDOW_POSITIONS = [-10.2, -5.4] as const;
const BACK_WINDOW_SIZE = { width: 2, height: 1.4 } as const;
const SIDE_WINDOW_SIZE = { width: 1.8, height: 1.25 } as const;
const WINDOW_OPENING_PADDING = 0.2;
const DAY_DURATION_SECONDS = 6 * 60 * 60;
const CELESTIAL_ORBIT_RADIUS_X = 24;
const CELESTIAL_ORBIT_RADIUS_Y = 13;
const CELESTIAL_ORBIT_CENTER_Y = 5;
const CELESTIAL_ORBIT_CENTER_Z = -18;
const DAY_SKY_COLOR = new Color("#87CEEB");
const NIGHT_SKY_COLOR = new Color("#0B1226");
const DAY_SKY_EMISSIVE = new Color("#BFDBFE");
const NIGHT_SKY_EMISSIVE = new Color("#1E3A8A");
const showOutdoorEnvironment = true;

const SCREEN_COLORS: Record<AgentStatus, { color: string; emissive: string; intensity: number }> = {
  idle: { color: "#1a1a2e", emissive: "#334155", intensity: 0.1 },
  thinking: { color: "#facc15", emissive: "#facc15", intensity: 0.4 },
  streaming: { color: "#22C55E", emissive: "#22C55E", intensity: 0.5 },
  tool_calling: { color: "#a78bfa", emissive: "#a78bfa", intensity: 0.4 },
  waiting: { color: "#fb923c", emissive: "#fb923c", intensity: 0.3 },
  error: { color: "#ef4444", emissive: "#ef4444", intensity: 0.6 },
  done: { color: "#22d3ee", emissive: "#22d3ee", intensity: 0.3 },
};

const PIZZA_CENTER: [number, number, number] = [0, 0, -6.35];
const PIZZA_RADIUS = 1.75;
const SCENE_FOCAL_POINT: [number, number, number] = [0, 0, -6];
const BASE_WORLD_CAPS = resolveWorldTierConfig(0).caps;
type ExteriorPropType = "tree" | "bench" | "lamp" | "flower";

interface PlantLayout {
  position: [number, number, number];
  scale: number;
}

interface ExteriorPropLayout {
  type: ExteriorPropType;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

interface WallOpeningSegment {
  center: number;
  length: number;
}

interface WallOpening {
  center: number;
  width: number;
}

const OFFICE_PLANT_LAYOUT: PlantLayout[] = [
  { position: [-10, 0, -13], scale: 1.15 },
  { position: [10, 0, -13], scale: 1.15 },
  { position: [-10, 0, 3], scale: 1.1 },
  { position: [10, 0, 3], scale: 1.1 },
  { position: [-3.4, 0, -13.1], scale: 0.9 },
  { position: [3.4, 0, -13.1], scale: 0.9 },
  { position: [-10.05, 0, -5.2], scale: 0.85 },
  { position: [10.05, 0, -5.2], scale: 0.85 },
  { position: [0, 0, 2.8], scale: 0.95 },
  { position: [6.8, 0, -11.3], scale: 0.75 },
  { position: [-6.9, 0, -11.2], scale: 0.78 },
  { position: [-1.8, 0, -11.7], scale: 0.82 },
  { position: [1.8, 0, -11.7], scale: 0.82 },
  { position: [0, 0, -12.5], scale: 0.88 },
  { position: [-6.9, 0, 2.4], scale: 0.84 },
  { position: [6.9, 0, 2.4], scale: 0.84 },
];
const EXTERIOR_PROP_LAYOUT: ExteriorPropLayout[] = [
  { type: "tree", position: [-15.5, 0, -15.8], scale: 1.5 },
  { type: "tree", position: [15.5, 0, -15.8], scale: 1.5 },
  { type: "tree", position: [-15.5, 0, 5.8], scale: 1.35 },
  { type: "tree", position: [15.5, 0, 5.8], scale: 1.35 },
  { type: "bench", position: [-13.4, 0, -6.2], rotation: [0, Math.PI / 2, 0], scale: 1.15 },
  { type: "bench", position: [13.4, 0, -6.2], rotation: [0, -Math.PI / 2, 0], scale: 1.15 },
  { type: "lamp", position: [-13.8, 0, -12], scale: 1 },
  { type: "lamp", position: [13.8, 0, -12], scale: 1 },
  { type: "flower", position: [-11.8, 0, 4.8], scale: 1.15 },
  { type: "flower", position: [11.8, 0, 4.8], scale: 1.15 },
  { type: "tree", position: [-1.6, 0, 7.2], scale: 1.2 },
  { type: "tree", position: [1.6, 0, 7.2], scale: 1.2 },
  { type: "bench", position: [0, 0, 7.8], rotation: [0, Math.PI, 0], scale: 1 },
  { type: "flower", position: [-4.8, 0, 6.6], scale: 0.95 },
  { type: "flower", position: [4.8, 0, 6.6], scale: 0.95 },
  { type: "lamp", position: [0, 0, 8.9], scale: 0.92 },
];

function computeWallSegments(
  span: number,
  openings: WallOpening[]
): WallOpeningSegment[] {
  const min = -span / 2;
  const max = span / 2;
  const sortedOpenings = [...openings].sort((a, b) => a.center - b.center);
  const segments: WallOpeningSegment[] = [];

  let cursor = min;

  for (const opening of sortedOpenings) {
    const openingMin = Math.max(min, opening.center - opening.width / 2);
    const openingMax = Math.min(max, opening.center + opening.width / 2);
    if (openingMin > cursor + 0.001) {
      segments.push({
        center: (cursor + openingMin) / 2,
        length: openingMin - cursor,
      });
    }
    cursor = Math.max(cursor, openingMax);
  }

  if (cursor < max - 0.001) {
    segments.push({
      center: (cursor + max) / 2,
      length: max - cursor,
    });
  }

  return segments;
}

function computePizzaSeat(index: number, total: number): [number, number, number] {
  const count = Math.max(3, total);
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return [
    PIZZA_CENTER[0] + Math.cos(angle) * PIZZA_RADIUS,
    0,
    PIZZA_CENTER[2] + Math.sin(angle) * PIZZA_RADIUS,
  ];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function resolveCelestialState(elapsedSeconds: number) {
  const phase = (elapsedSeconds % DAY_DURATION_SECONDS) / DAY_DURATION_SECONDS;
  const sunAngle = phase * Math.PI * 2 - Math.PI / 2;
  const moonAngle = sunAngle + Math.PI;
  const sunPosition: [number, number, number] = [
    Math.cos(sunAngle) * CELESTIAL_ORBIT_RADIUS_X,
    Math.sin(sunAngle) * CELESTIAL_ORBIT_RADIUS_Y + CELESTIAL_ORBIT_CENTER_Y,
    CELESTIAL_ORBIT_CENTER_Z + Math.sin(sunAngle) * 1.4,
  ];
  const moonPosition: [number, number, number] = [
    Math.cos(moonAngle) * CELESTIAL_ORBIT_RADIUS_X,
    Math.sin(moonAngle) * CELESTIAL_ORBIT_RADIUS_Y + CELESTIAL_ORBIT_CENTER_Y,
    CELESTIAL_ORBIT_CENTER_Z + Math.sin(moonAngle) * 1.4,
  ];
  const daylight = clamp01((sunPosition[1] + 1.2) / (CELESTIAL_ORBIT_RADIUS_Y + 1.2));
  const moonlight = clamp01((moonPosition[1] + 1.2) / (CELESTIAL_ORBIT_RADIUS_Y + 1.2));

  return { phase, daylight, moonlight, sunPosition, moonPosition };
}

function Desk({
  position,
  rotation = [0, 0, 0],
  screen,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  screen?: { color: string; emissive: string; intensity: number };
}) {
  const sc = screen ?? { color: "#22C55E", emissive: "#22C55E", intensity: 0.3 };

  return (
    <group position={position} rotation={rotation}>
      {/* Desktop surface */}
      <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.08, 0.8]} />
        <meshStandardMaterial color={DESK_COLOR} />
      </mesh>
      {/* Legs */}
      {[
        [-0.7, 0.375, -0.3],
        [0.7, 0.375, -0.3],
        [-0.7, 0.375, 0.3],
        [0.7, 0.375, 0.3],
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} castShadow>
          <boxGeometry args={[0.08, 0.75, 0.08]} />
          <meshStandardMaterial color="#5C4A1E" />
        </mesh>
      ))}
      {/* Monitor */}
      <mesh position={[0, 1.2, -0.2]} castShadow>
        <boxGeometry args={[0.8, 0.5, 0.05]} />
        <meshStandardMaterial color={MONITOR_COLOR} />
      </mesh>
      {/* Monitor screen — status-aware */}
      <mesh position={[0, 1.2, -0.17]}>
        <boxGeometry args={[0.7, 0.4, 0.01]} />
        <meshStandardMaterial
          color={sc.color}
          emissive={sc.emissive}
          emissiveIntensity={sc.intensity}
        />
      </mesh>
      {/* Monitor stand */}
      <mesh position={[0, 0.92, -0.2]}>
        <boxGeometry args={[0.1, 0.3, 0.1]} />
        <meshStandardMaterial color={MONITOR_COLOR} />
      </mesh>
      {/* Chair */}
      <mesh position={[0, 0.45, 0.7]} castShadow>
        <boxGeometry args={[0.5, 0.08, 0.5]} />
        <meshStandardMaterial color="#4A5568" />
      </mesh>
      <mesh position={[0, 0.75, 0.95]}>
        <boxGeometry args={[0.5, 0.5, 0.08]} />
        <meshStandardMaterial color="#4A5568" />
      </mesh>
    </group>
  );
}

function Bookshelf({
  position,
}: {
  position: [number, number, number];
}) {
  const bookColors = ["#E74C3C", "#3498DB", "#2ECC71", "#F39C12", "#9B59B6", "#1ABC9C"];
  return (
    <group position={position}>
      {/* Frame */}
      <mesh castShadow>
        <boxGeometry args={[1.5, 2.2, 0.4]} />
        <meshStandardMaterial color="#6B4226" />
      </mesh>
      {/* Books */}
      {bookColors.map((color, i) => (
        <mesh
          key={i}
          position={[-0.5 + i * 0.2, 0.6 - Math.floor(i / 3) * 0.7, 0.05]}
          castShadow
        >
          <boxGeometry args={[0.15, 0.5, 0.25]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

function MonitorWall({
  position,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  return (
    <group position={position} rotation={rotation}>
      {Array.from({ length: 6 }).map((_, i) => {
        const row = Math.floor(i / 3);
        const col = i % 3;
        return (
          <mesh
            key={i}
            position={[-0.7 + col * 0.7, 1.8 - row * 0.6, 0]}
          >
            <boxGeometry args={[0.6, 0.45, 0.05]} />
            <meshStandardMaterial
              color="#0F172A"
              emissive="#4ECDC4"
              emissiveIntensity={0.15 + Math.sin(i * 1.3) * 0.1}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function TaskBoard({
  position,
}: {
  position: [number, number, number];
}) {
  const noteColors = ["#FFE066", "#FF6B6B", "#4ECDC4", "#96CEB4", "#FF6B35", "#DDA0DD"];
  return (
    <group position={position}>
      {/* Board */}
      <mesh>
        <boxGeometry args={[1.8, 1.2, 0.05]} />
        <meshStandardMaterial color="#F5F0EB" />
      </mesh>
      {/* Sticky notes */}
      {Array.from({ length: 12 }).map((_, i) => {
        const row = Math.floor(i / 4);
        const col = i % 4;
        return (
          <mesh
            key={i}
            position={[-0.6 + col * 0.4, 0.35 - row * 0.35, 0.03]}
          >
            <boxGeometry args={[0.3, 0.28, 0.01]} />
            <meshStandardMaterial color={noteColors[i % noteColors.length]} />
          </mesh>
        );
      })}
    </group>
  );
}

function CoffeeStation({
  position,
}: {
  position: [number, number, number];
}) {
  return (
    <group position={position}>
      {/* Counter */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1.2, 1, 0.5]} />
        <meshStandardMaterial color="#5C3D2E" />
      </mesh>
      {/* Coffee machine */}
      <mesh position={[-0.3, 1.2, 0]} castShadow>
        <boxGeometry args={[0.35, 0.45, 0.3]} />
        <meshStandardMaterial color="#2D3748" />
      </mesh>
      {/* Cup */}
      <mesh position={[0.3, 1.08, 0]}>
        <cylinderGeometry args={[0.08, 0.06, 0.15, 8]} />
        <meshStandardMaterial color="white" />
      </mesh>
    </group>
  );
}

function ServerRack({
  position,
}: {
  position: [number, number, number];
}) {
  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[0.8, 2, 0.6]} />
        <meshStandardMaterial color="#1A1A2E" />
      </mesh>
      {/* Blinking lights */}
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh
          key={i}
          position={[-0.2 + (i % 4) * 0.13, 0.7 - Math.floor(i / 4) * 0.3, 0.31]}
        >
          <boxGeometry args={[0.05, 0.05, 0.01]} />
          <meshStandardMaterial
            color={i % 3 === 0 ? "#EF4444" : "#22C55E"}
            emissive={i % 3 === 0 ? "#EF4444" : "#22C55E"}
            emissiveIntensity={0.8}
          />
        </mesh>
      ))}
    </group>
  );
}

function InstancedPlantPots({
  plants,
}: {
  plants: PlantLayout[];
}) {
  const potsRef = useRef<InstancedMesh>(null);
  const matrixHelper = useMemo(() => new Object3D(), []);

  useLayoutEffect(() => {
    const mesh = potsRef.current;
    if (!mesh) return;

    for (let index = 0; index < plants.length; index += 1) {
      const plant = plants[index];
      matrixHelper.position.set(
        plant.position[0],
        plant.position[1] + 0.2 * plant.scale,
        plant.position[2]
      );
      matrixHelper.rotation.set(0, 0, 0);
      matrixHelper.scale.setScalar(plant.scale);
      matrixHelper.updateMatrix();
      mesh.setMatrixAt(index, matrixHelper.matrix);
    }

    mesh.count = plants.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrixHelper, plants]);

  if (plants.length === 0) return null;

  return (
    <instancedMesh ref={potsRef} args={[undefined, undefined, plants.length]} castShadow>
      <cylinderGeometry args={[0.2, 0.15, 0.4, 8]} />
      <meshStandardMaterial color="#8B4513" />
    </instancedMesh>
  );
}

function PlantLeaves({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      {/* Leaves */}
      {[
        [0, 0.6, 0],
        [-0.15, 0.55, 0.1],
        [0.15, 0.55, -0.1],
        [0, 0.7, 0.1],
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]}>
          <boxGeometry args={[0.2, 0.25, 0.2]} />
          <meshStandardMaterial color={i % 2 === 0 ? "#22C55E" : "#16A34A"} />
        </mesh>
      ))}
    </group>
  );
}

function WallWindow({
  position,
  rotation = [0, 0, 0],
  width = 2,
  height = 1.4,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  width?: number;
  height?: number;
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[width + 0.25, height + 0.25, 0.06]} />
        <meshStandardMaterial color="#6B5A48" />
      </mesh>
      <mesh position={[0, 0, 0.025]}>
        <boxGeometry args={[width, height, 0.02]} />
        <meshStandardMaterial
          color="#93C5FD"
          emissive="#7DD3FC"
          emissiveIntensity={0.35}
          transparent
          opacity={0.8}
        />
      </mesh>
      <mesh position={[0, 0, 0.035]}>
        <boxGeometry args={[0.08, height, 0.03]} />
        <meshStandardMaterial color="#5A4632" />
      </mesh>
      <mesh position={[0, 0, 0.035]}>
        <boxGeometry args={[width, 0.08, 0.03]} />
        <meshStandardMaterial color="#5A4632" />
      </mesh>
    </group>
  );
}

function WallWithWindowOpenings({
  position,
  span,
  spanAxis = "x",
  openings,
  openingCenterY,
  openingHeight,
  wallHeight = 4,
  wallThickness = 0.2,
}: {
  position: [number, number, number];
  span: number;
  spanAxis?: "x" | "z";
  openings: WallOpening[];
  openingCenterY: number;
  openingHeight: number;
  wallHeight?: number;
  wallThickness?: number;
}) {
  const minY = -wallHeight / 2;
  const maxY = wallHeight / 2;
  const openingBottom = Math.max(minY, openingCenterY - openingHeight / 2);
  const openingTop = Math.min(maxY, openingCenterY + openingHeight / 2);
  const lowerBandHeight = Math.max(0, openingBottom - minY);
  const upperBandHeight = Math.max(0, maxY - openingTop);
  const middleBandHeight = Math.max(0, openingTop - openingBottom);
  const middleSegments = middleBandHeight > 0 ? computeWallSegments(span, openings) : [];

  return (
    <group position={position}>
      {lowerBandHeight > 0 && (
        <mesh position={[0, minY + lowerBandHeight / 2, 0]} receiveShadow>
          <boxGeometry
            args={
              spanAxis === "x"
                ? [span, lowerBandHeight, wallThickness]
                : [wallThickness, lowerBandHeight, span]
            }
          />
          <meshStandardMaterial color={WALL_COLOR} />
        </mesh>
      )}
      {upperBandHeight > 0 && (
        <mesh position={[0, openingTop + upperBandHeight / 2, 0]} receiveShadow>
          <boxGeometry
            args={
              spanAxis === "x"
                ? [span, upperBandHeight, wallThickness]
                : [wallThickness, upperBandHeight, span]
            }
          />
          <meshStandardMaterial color={WALL_COLOR} />
        </mesh>
      )}
      {middleSegments.map((segment, index) => (
        <mesh
          key={`wall-column-${spanAxis}-${index}`}
          position={
            spanAxis === "x"
              ? [segment.center, openingBottom + middleBandHeight / 2, 0]
              : [0, openingBottom + middleBandHeight / 2, segment.center]
          }
          receiveShadow
        >
          <boxGeometry
            args={
              spanAxis === "x"
                ? [segment.length, middleBandHeight, wallThickness]
                : [wallThickness, middleBandHeight, segment.length]
            }
          />
          <meshStandardMaterial color={WALL_COLOR} />
        </mesh>
      ))}
    </group>
  );
}

function Whiteboard({
  position,
}: {
  position: [number, number, number];
}) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[2.5, 1.5, 0.05]} />
        <meshStandardMaterial color="white" />
      </mesh>
      <mesh position={[-0.3, 0.2, 0.03]}>
        <boxGeometry args={[0.8, 0.02, 0.01]} />
        <meshStandardMaterial color="#4ECDC4" />
      </mesh>
      <mesh position={[0.2, -0.1, 0.03]}>
        <boxGeometry args={[0.6, 0.02, 0.01]} />
        <meshStandardMaterial color="#FF6B35" />
      </mesh>
    </group>
  );
}

function SkyDome({
  materialRef,
}: {
  materialRef: { current: MeshStandardMaterial | null };
}) {
  return (
    <mesh>
      <sphereGeometry args={[85, 48, 24]} />
      <meshStandardMaterial
        ref={materialRef}
        color="#87CEEB"
        emissive="#BFDBFE"
        emissiveIntensity={0.2}
        side={1}
      />
    </mesh>
  );
}

function ExteriorTree({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.27, 1.8, 10]} />
        <meshStandardMaterial color="#6B4F3A" />
      </mesh>
      <mesh position={[0, 2.3, 0]} castShadow>
        <sphereGeometry args={[0.95, 16, 12]} />
        <meshStandardMaterial color="#2F855A" />
      </mesh>
      <mesh position={[-0.45, 2.05, 0.25]} castShadow>
        <sphereGeometry args={[0.55, 14, 10]} />
        <meshStandardMaterial color="#3FA16E" />
      </mesh>
      <mesh position={[0.5, 1.95, -0.25]} castShadow>
        <sphereGeometry args={[0.5, 14, 10]} />
        <meshStandardMaterial color="#3FA16E" />
      </mesh>
    </group>
  );
}

function ExteriorBench({
  position,
  rotation = [0, 0, 0],
  scale = 1,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh position={[0, 0.52, 0]} castShadow>
        <boxGeometry args={[1.8, 0.08, 0.38]} />
        <meshStandardMaterial color="#7A5A3A" />
      </mesh>
      <mesh position={[0, 0.75, -0.14]} castShadow>
        <boxGeometry args={[1.8, 0.4, 0.08]} />
        <meshStandardMaterial color="#7A5A3A" />
      </mesh>
      {[-0.75, 0.75].map((x) => (
        <mesh key={x} position={[x, 0.3, 0]} castShadow>
          <boxGeometry args={[0.1, 0.5, 0.1]} />
          <meshStandardMaterial color="#4B5563" />
        </mesh>
      ))}
    </group>
  );
}

function ExteriorLamp({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 1.5, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 3, 12]} />
        <meshStandardMaterial color="#4B5563" />
      </mesh>
      <mesh position={[0, 3.15, 0]}>
        <sphereGeometry args={[0.2, 12, 10]} />
        <meshStandardMaterial color="#FDE68A" emissive="#FCD34D" emissiveIntensity={0.45} />
      </mesh>
    </group>
  );
}

function ExteriorFlowerBed({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.68, 0.68, 0.24, 18]} />
        <meshStandardMaterial color="#6B7280" />
      </mesh>
      {[
        [-0.22, 0.34, 0.16, "#FB7185"],
        [0.24, 0.3, -0.08, "#F97316"],
        [0.12, 0.32, 0.22, "#FACC15"],
        [-0.1, 0.28, -0.18, "#A78BFA"],
      ].map(([x, y, z, color], index) => (
        <mesh key={index} position={[x as number, y as number, z as number]}>
          <sphereGeometry args={[0.12, 10, 8]} />
          <meshStandardMaterial color={color as string} />
        </mesh>
      ))}
    </group>
  );
}

function YardBorderShrubs() {
  const shrubPositions: [number, number, number][] = [
    [-10.4, 0, -15.9],
    [-6.8, 0, -16.1],
    [-3.1, 0, -16.2],
    [2.7, 0, -16.2],
    [6.2, 0, -16.05],
    [10.2, 0, -15.9],
    [-10.45, 0, 5.95],
    [10.45, 0, 5.95],
  ];

  return (
    <group>
      {shrubPositions.map((position, index) => (
        <mesh key={`yard-shrub-${index}`} position={position} castShadow>
          <sphereGeometry args={[0.38 + (index % 3) * 0.05, 14, 10]} />
          <meshStandardMaterial color={index % 2 === 0 ? "#2F855A" : "#3FA16E"} />
        </mesh>
      ))}
    </group>
  );
}

function ExteriorCampusBackdrop({
  showBlueSky,
  richEnvironment,
}: {
  showBlueSky: boolean;
  richEnvironment: boolean;
}) {
  const skyColor = showBlueSky
    ? richEnvironment
      ? "#B8E0FF"
      : "#CDE8FF"
    : "#CBD5E1";
  const skylineColor = richEnvironment ? "#7C8FA4" : "#94A3B8";

  return (
    <group>
      <mesh position={[0, 3.2, -20]}>
        <planeGeometry args={[38, 8]} />
        <meshStandardMaterial color={skyColor} emissive={skyColor} emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[0, 0.9, -18.8]} receiveShadow>
        <boxGeometry args={[24, 1.8, 0.9]} />
        <meshStandardMaterial color={showBlueSky ? "#A0AEC0" : "#9CA3AF"} />
      </mesh>
      {[-8.6, -5.2, -2.1, 1.4, 4.7, 8.1].map((x, index) => (
        <mesh
          key={`backdrop-building-${index}`}
          position={[x, 1.7 + (index % 3) * 0.32, -18.15 - (index % 2) * 0.22]}
          receiveShadow
        >
          <boxGeometry args={[1.75, 2.1 + (index % 3) * 0.58, 0.62]} />
          <meshStandardMaterial color={index % 2 === 0 ? skylineColor : "#64748B"} />
        </mesh>
      ))}
      <mesh position={[-18.7, 2.1, -5]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[24, 6]} />
        <meshStandardMaterial color={skyColor} emissive={skyColor} emissiveIntensity={0.09} />
      </mesh>
      <mesh position={[18.7, 2.1, -5]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[24, 6]} />
        <meshStandardMaterial color={skyColor} emissive={skyColor} emissiveIntensity={0.09} />
      </mesh>
    </group>
  );
}

function OfficeSnackBar({
  position,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const snackColors = ["#F59E0B", "#EF4444", "#22C55E", "#3B82F6", "#EC4899", "#8B5CF6", "#06B6D4", "#F97316"];

  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.8, 1, 0.95]} />
        <meshStandardMaterial color="#7C5841" />
      </mesh>
      <mesh position={[0, 1.02, -0.02]} castShadow>
        <boxGeometry args={[2.95, 0.08, 1.02]} />
        <meshStandardMaterial color="#D9C2A0" />
      </mesh>
      <mesh position={[0, 1.72, -0.43]} castShadow>
        <boxGeometry args={[2.95, 1.7, 0.12]} />
        <meshStandardMaterial color="#F2ECE3" />
      </mesh>
      {[1.1, 1.62].map((y) => (
        <mesh key={`snack-shelf-${y}`} position={[0, y, -0.36]} castShadow>
          <boxGeometry args={[2.5, 0.05, 0.18]} />
          <meshStandardMaterial color="#8B6B52" />
        </mesh>
      ))}
      {snackColors.map((color, index) => {
        const row = Math.floor(index / 4);
        const col = index % 4;
        return (
          <mesh
            key={`snack-jar-${index}`}
            position={[-0.98 + col * 0.65, 1.2 + row * 0.54, -0.28]}
          >
            <cylinderGeometry args={[0.11, 0.11, 0.2, 14]} />
            <meshStandardMaterial color={color} />
          </mesh>
        );
      })}
      {[-0.55, -0.05, 0.45].map((x, index) => (
        <group key={`snack-tap-${index}`} position={[x, 1.2, 0.08]}>
          <mesh>
            <boxGeometry args={[0.12, 0.22, 0.12]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
          <mesh position={[0, -0.12, 0.06]}>
            <boxGeometry args={[0.04, 0.06, 0.08]} />
            <meshStandardMaterial color="#94A3B8" />
          </mesh>
        </group>
      ))}
      <mesh position={[1.18, 0.72, 0.07]} castShadow>
        <boxGeometry args={[0.48, 1.44, 0.6]} />
        <meshStandardMaterial color="#D1D5DB" />
      </mesh>
      <mesh position={[1.18, 1.2, 0.39]}>
        <boxGeometry args={[0.42, 0.9, 0.04]} />
        <meshStandardMaterial color="#F8FAFC" />
      </mesh>
      <mesh position={[1.03, 1.2, 0.43]}>
        <boxGeometry args={[0.02, 0.24, 0.02]} />
        <meshStandardMaterial color="#64748B" />
      </mesh>
      {[-0.82, 0, 0.82].map((x) => (
        <group key={`snack-stool-${x}`} position={[x, 0, 1]}>
          <mesh position={[0, 0.6, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.22, 0.08, 16]} />
            <meshStandardMaterial color="#2F3E4F" />
          </mesh>
          <mesh position={[0, 0.3, 0]} castShadow>
            <cylinderGeometry args={[0.04, 0.05, 0.6, 10]} />
            <meshStandardMaterial color="#4B5563" />
          </mesh>
        </group>
      ))}
      <mesh position={[-1.14, 1.12, 0.16]}>
        <cylinderGeometry args={[0.18, 0.12, 0.1, 14]} />
        <meshStandardMaterial color="#A16207" />
      </mesh>
      {[[-1.2, 1.19, 0.13], [-1.1, 1.2, 0.2], [-1.08, 1.2, 0.11]].map((pos, index) => (
        <mesh key={`snack-fruit-${index}`} position={pos as [number, number, number]}>
          <sphereGeometry args={[0.05, 10, 8]} />
          <meshStandardMaterial color={index === 0 ? "#EF4444" : index === 1 ? "#F97316" : "#FACC15"} />
        </mesh>
      ))}
      <mesh position={[0.1, 2.2, -0.36]}>
        <boxGeometry args={[1.4, 0.32, 0.04]} />
        <meshStandardMaterial
          color="#FDE68A"
          emissive="#FBBF24"
          emissiveIntensity={0.45}
        />
      </mesh>
    </group>
  );
}

export function Office() {
  const agents = useDemoStore((s) => s.agents);
  const sceneUnlocks = useDemoStore((s) => s.sceneUnlocks);
  const sceneCaps = useDemoStore((s) => s.sceneCaps);
  const skyMaterialRef = useRef<MeshStandardMaterial>(null);
  const sunMaterialRef = useRef<MeshStandardMaterial>(null);
  const moonMaterialRef = useRef<MeshStandardMaterial>(null);
  const ambientLightRef = useRef<AmbientLight>(null);
  const sunLightRef = useRef<DirectionalLight>(null);
  const moonLightRef = useRef<DirectionalLight>(null);
  const indoorFillARef = useRef<PointLight>(null);
  const indoorFillBRef = useRef<PointLight>(null);
  const sunOrbRef = useRef<Object3D>(null);
  const moonOrbRef = useRef<Object3D>(null);
  const experimentalDecorationsEnabled = useDemoStore(
    (s) => s.experimentalDecorationsEnabled
  );
  const deskLayout = useMemo(
    () =>
      resolveOfficeDeskLayout(
        Math.max(BASE_WORLD_CAPS.maxDesks, sceneCaps.maxDesks, agents.length)
      ),
    [agents.length, sceneCaps.maxDesks]
  );
  const officeDetailVisibility = useMemo(
    () =>
      resolveOfficeDetailVisibility({
        unlocks: sceneUnlocks,
        caps: sceneCaps,
        experimentalDecorationsEnabled,
        totalPlantSlots: OFFICE_PLANT_LAYOUT.length,
      }),
    [experimentalDecorationsEnabled, sceneCaps, sceneUnlocks]
  );
  const exteriorVisibility = useMemo(
    () =>
      resolveExteriorVisibility({
        unlocks: sceneUnlocks,
        caps: sceneCaps,
        totalExteriorPropSlots: EXTERIOR_PROP_LAYOUT.length,
      }),
    [sceneCaps, sceneUnlocks]
  );
  const detailProps = useMemo(
    () => [
      <MonitorWall key="detail-monitor-wall" position={[10.88, 0, -5]} rotation={[0, -Math.PI / 2, 0]} />,
      <Bookshelf key="detail-bookshelf" position={[-6, 1.1, -13.7]} />,
      <CoffeeStation key="detail-coffee" position={[6, 0, -12]} />,
      <ServerRack key="detail-server-rack" position={[9.5, 1, -12]} />,
      <Whiteboard key="detail-whiteboard" position={[2, 1.5, -13.85]} />,
    ],
    []
  );
  const officePlantCullDistance = sceneUnlocks.worldRichness
    ? NON_CRITICAL_CULL_DISTANCE.officePlantsRich
    : officeDetailVisibility.showDetailDecorations
      ? NON_CRITICAL_CULL_DISTANCE.officePlantsDetail
      : NON_CRITICAL_CULL_DISTANCE.officePlantsBase;
  const visiblePlants = useMemo(
    () =>
      resolveDistanceCulledItems({
        items: OFFICE_PLANT_LAYOUT,
        maxVisibleCount: officeDetailVisibility.visiblePlantCount,
        focalPoint: SCENE_FOCAL_POINT,
        maxDistance: officePlantCullDistance,
      }),
    [officeDetailVisibility.visiblePlantCount, officePlantCullDistance]
  );
  const exteriorCullDistance = exteriorVisibility.richEnvironment
    ? NON_CRITICAL_CULL_DISTANCE.exteriorTier4
    : NON_CRITICAL_CULL_DISTANCE.exteriorTier3;
  const visibleExteriorPropCount = Math.max(6, exteriorVisibility.visibleExteriorPropCount);
  const visibleExteriorProps = useMemo(
    () =>
      resolveDistanceCulledItems({
        items: EXTERIOR_PROP_LAYOUT,
        maxVisibleCount: visibleExteriorPropCount,
        focalPoint: SCENE_FOCAL_POINT,
        maxDistance: exteriorCullDistance,
      }),
    [exteriorCullDistance, visibleExteriorPropCount]
  );
  const visibleAgents = useMemo(
    () => agents.slice(0, deskLayout.length),
    [agents, deskLayout.length]
  );
  const partyAgents = useMemo(
    () =>
      visibleAgents
        .filter((agent) => agent.activeCelebration === "pizza_party")
        .sort((a, b) => a.deskIndex - b.deskIndex),
    [visibleAgents]
  );
  const partySeatByAgentId = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (let index = 0; index < partyAgents.length; index += 1) {
      map.set(partyAgents[index].id, computePizzaSeat(index, partyAgents.length));
    }
    return map;
  }, [partyAgents]);
  const partyStartedAt = partyAgents.reduce(
    (latest, agent) => Math.max(latest, agent.celebrationStartedAt ?? 0),
    0
  );

  useFrame(({ clock }) => {
    const { daylight, moonlight, sunPosition, moonPosition } = resolveCelestialState(clock.getElapsedTime());

    if (sunOrbRef.current) {
      sunOrbRef.current.position.set(sunPosition[0], sunPosition[1], sunPosition[2]);
    }
    if (moonOrbRef.current) {
      moonOrbRef.current.position.set(moonPosition[0], moonPosition[1], moonPosition[2]);
    }
    if (sunLightRef.current) {
      sunLightRef.current.position.set(sunPosition[0], sunPosition[1], sunPosition[2]);
      sunLightRef.current.intensity = MathUtils.lerp(0.05, 1.2, daylight);
      sunLightRef.current.color.setRGB(
        MathUtils.lerp(0.55, 1, daylight),
        MathUtils.lerp(0.62, 0.98, daylight),
        MathUtils.lerp(0.74, 0.9, daylight)
      );
    }
    if (moonLightRef.current) {
      moonLightRef.current.position.set(moonPosition[0], moonPosition[1], moonPosition[2]);
      moonLightRef.current.intensity = MathUtils.lerp(0.06, 0.42, moonlight);
    }
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = MathUtils.lerp(0.2, 0.58, daylight);
      ambientLightRef.current.color.setRGB(
        MathUtils.lerp(0.3, 1, daylight),
        MathUtils.lerp(0.35, 0.98, daylight),
        MathUtils.lerp(0.5, 0.92, daylight)
      );
    }
    if (indoorFillARef.current) {
      indoorFillARef.current.intensity = MathUtils.lerp(0.52, 0.18, daylight);
    }
    if (indoorFillBRef.current) {
      indoorFillBRef.current.intensity = MathUtils.lerp(0.46, 0.18, daylight);
    }
    if (skyMaterialRef.current) {
      skyMaterialRef.current.color.copy(NIGHT_SKY_COLOR).lerp(DAY_SKY_COLOR, daylight);
      skyMaterialRef.current.emissive.copy(NIGHT_SKY_EMISSIVE).lerp(DAY_SKY_EMISSIVE, daylight);
      skyMaterialRef.current.emissiveIntensity = MathUtils.lerp(0.18, 0.22, daylight);
    }
    if (sunMaterialRef.current) {
      sunMaterialRef.current.emissiveIntensity = MathUtils.lerp(0.22, 1.35, daylight);
    }
    if (moonMaterialRef.current) {
      moonMaterialRef.current.emissiveIntensity = MathUtils.lerp(0.06, 0.7, moonlight);
    }
  });

  return (
    <group>
      <SkyDome materialRef={skyMaterialRef} />

      {/* Lighting */}
      <ambientLight ref={ambientLightRef} intensity={0.52} />
      <directionalLight
        ref={sunLightRef}
        position={[5, 8, 5]}
        intensity={1.05}
        color="#EFF6FF"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      <directionalLight
        ref={moonLightRef}
        position={[-8, 10, -12]}
        intensity={0.2}
        color="#93C5FD"
      />
      <pointLight ref={indoorFillARef} position={[-4, 3, -4]} intensity={0.3} color="#FFE4B5" />
      <pointLight ref={indoorFillBRef} position={[4, 3, -9]} intensity={0.3} color="#FFE4B5" />

      <mesh ref={sunOrbRef} position={[0, 10, CELESTIAL_ORBIT_CENTER_Z]}>
        <sphereGeometry args={[0.95, 22, 18]} />
        <meshStandardMaterial
          ref={sunMaterialRef}
          color="#FDE68A"
          emissive="#FDBA74"
          emissiveIntensity={1}
        />
      </mesh>
      <mesh ref={moonOrbRef} position={[0, -8, CELESTIAL_ORBIT_CENTER_Z]}>
        <sphereGeometry args={[0.72, 20, 16]} />
        <meshStandardMaterial
          ref={moonMaterialRef}
          color="#E2E8F0"
          emissive="#93C5FD"
          emissiveIntensity={0.2}
        />
      </mesh>

      {showOutdoorEnvironment && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -5]} receiveShadow>
            <planeGeometry args={[42, 36]} />
            <meshStandardMaterial color={exteriorVisibility.richEnvironment ? "#7FBD65" : "#6FAF55"} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, -5]} receiveShadow>
            <planeGeometry args={[28, 24]} />
            <meshStandardMaterial
              color={exteriorVisibility.richEnvironment ? "#D6C39A" : "#CBB58B"}
              transparent
              opacity={0.75}
            />
          </mesh>
          <YardBorderShrubs />
        </>
      )}

      <ExteriorCampusBackdrop
        showBlueSky={showOutdoorEnvironment}
        richEnvironment={exteriorVisibility.richEnvironment}
      />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -5]} receiveShadow>
        <planeGeometry args={[22, 18]} />
        <meshStandardMaterial color={FLOOR_COLOR} />
      </mesh>

      {/* Back wall with true window openings */}
      <WallWithWindowOpenings
        position={[0, 2, -14]}
        span={22}
        spanAxis="x"
        openings={BACK_WINDOW_POSITIONS.map((x) => ({
          center: x,
          width: BACK_WINDOW_SIZE.width + WINDOW_OPENING_PADDING,
        }))}
        openingCenterY={0.45}
        openingHeight={BACK_WINDOW_SIZE.height + WINDOW_OPENING_PADDING}
      />
      {/* Windows kept parallel to wall planes */}
      {BACK_WINDOW_POSITIONS.map((x) => (
        <WallWindow
          key={`back-window-${x}`}
          position={[x, 2.45, -13.88]}
          width={BACK_WINDOW_SIZE.width}
          height={BACK_WINDOW_SIZE.height}
        />
      ))}
      {SIDE_WINDOW_POSITIONS.map((z) => (
        <WallWindow
          key={`left-window-${z}`}
          position={[-10.88, 2.35, z]}
          rotation={[0, Math.PI / 2, 0]}
          width={SIDE_WINDOW_SIZE.width}
          height={SIDE_WINDOW_SIZE.height}
        />
      ))}
      {SIDE_WINDOW_POSITIONS.map((z) => (
        <WallWindow
          key={`right-window-${z}`}
          position={[10.88, 2.35, z]}
          rotation={[0, -Math.PI / 2, 0]}
          width={SIDE_WINDOW_SIZE.width}
          height={SIDE_WINDOW_SIZE.height}
        />
      ))}

      {/* Side walls with true window openings */}
      <WallWithWindowOpenings
        position={[-11, 2, -5]}
        span={18}
        spanAxis="z"
        openings={SIDE_WINDOW_POSITIONS.map((z) => ({
          center: z + 5,
          width: SIDE_WINDOW_SIZE.width + WINDOW_OPENING_PADDING,
        }))}
        openingCenterY={0.35}
        openingHeight={SIDE_WINDOW_SIZE.height + WINDOW_OPENING_PADDING}
      />
      <WallWithWindowOpenings
        position={[11, 2, -5]}
        span={18}
        spanAxis="z"
        openings={SIDE_WINDOW_POSITIONS.map((z) => ({
          center: z + 5,
          width: SIDE_WINDOW_SIZE.width + WINDOW_OPENING_PADDING,
        }))}
        openingCenterY={0.35}
        openingHeight={SIDE_WINDOW_SIZE.height + WINDOW_OPENING_PADDING}
      />

      {/* Office snack bar */}
      <OfficeSnackBar position={[10.05, 0, 0.95]} rotation={[0, -Math.PI / 2, 0]} />

      {/* Ceiling lights */}
      {[
        [-4, 3.9, -4],
        [4, 3.9, -4],
        [-4, 3.9, -9],
        [4, 3.9, -9],
        [0, 3.9, -6.5],
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]}>
          <boxGeometry args={[2, 0.05, 0.5]} />
          <meshStandardMaterial
            color="white"
            emissive="white"
            emissiveIntensity={0.5}
          />
        </mesh>
      ))}

      {/* Agent desks + characters + celebrations */}
      {visibleAgents.map((agent) => {
        const layout = deskLayout[agent.deskIndex];
        if (!layout) return null;
        const partyTarget = partySeatByAgentId.get(agent.id) ?? null;
        return (
          <group key={agent.id}>
            <Desk
              position={layout.position}
              rotation={layout.rotation}
              screen={SCREEN_COLORS[agent.status]}
            />
            <AgentCharacter
              agent={agent}
              position={layout.facing}
              rotation={[0, 0, 0]}
              partyTargetPosition={partyTarget}
              partyLookAtPosition={PIZZA_CENTER}
            />
            {agent.activeCelebration && agent.celebrationStartedAt && agent.activeCelebration !== "pizza_party" && (
              <CelebrationEffect
                type={agent.activeCelebration}
                startedAt={agent.celebrationStartedAt}
                position={layout.position}
              />
            )}
          </group>
        );
      })}

      {partyAgents.length > 0 && (
        <group>
          {/* Shared pizza table where agents gather */}
          <mesh position={[PIZZA_CENTER[0], 0.72, PIZZA_CENTER[2]]} castShadow receiveShadow>
            <cylinderGeometry args={[1.1, 1.1, 0.08, 26]} />
            <meshStandardMaterial color="#6B4226" />
          </mesh>
          <mesh position={[PIZZA_CENTER[0], 0.38, PIZZA_CENTER[2]]} castShadow>
            <cylinderGeometry args={[0.12, 0.18, 0.72, 10]} />
            <meshStandardMaterial color="#4A2F1D" />
          </mesh>
          <mesh position={[PIZZA_CENTER[0], 0.03, PIZZA_CENTER[2]]}>
            <cylinderGeometry args={[0.55, 0.55, 0.05, 14]} />
            <meshStandardMaterial color="#4A2F1D" />
          </mesh>

          {/* Pizza boxes + visible pizza slices */}
          <mesh position={[PIZZA_CENTER[0] - 0.22, 0.79, PIZZA_CENTER[2] - 0.08]}>
            <boxGeometry args={[0.48, 0.04, 0.48]} />
            <meshStandardMaterial color="#C87830" />
          </mesh>
          <mesh position={[PIZZA_CENTER[0] + 0.18, 0.81, PIZZA_CENTER[2] + 0.05]}>
            <cylinderGeometry args={[0.19, 0.19, 0.02, 24]} />
            <meshStandardMaterial color="#F4D03F" />
          </mesh>
          {Array.from({ length: 6 }, (_, index) => {
            const angle = (index / 6) * Math.PI * 2;
            return (
              <mesh
                key={`slice-${index}`}
                position={[
                  PIZZA_CENTER[0] + 0.18 + Math.cos(angle) * 0.09,
                  0.825,
                  PIZZA_CENTER[2] + 0.05 + Math.sin(angle) * 0.09,
                ]}
                rotation={[0, -angle, 0]}
              >
                <boxGeometry args={[0.075, 0.008, 0.03]} />
                <meshStandardMaterial color="#C45050" />
              </mesh>
            );
          })}

          {partyStartedAt > 0 && (
            <CelebrationEffect
              key={`pizza-party-${partyStartedAt}`}
              type="pizza_party"
              startedAt={partyStartedAt}
              position={PIZZA_CENTER}
            />
          )}
        </group>
      )}

      {/* Task board */}
      <TaskBoard position={[0, 1.8, -13.85]} />

      {/* Tier-gated detail props */}
      {detailProps.slice(0, officeDetailVisibility.visibleDetailPropCount)}

      {/* Plants throughout the office */}
      <InstancedPlantPots plants={visiblePlants} />
      {visiblePlants.map((plant, index) => (
        <PlantLeaves key={`office-plant-${index}`} position={plant.position} scale={plant.scale} />
      ))}

      {visibleExteriorProps.map((prop, index) => {
        if (prop.type === "tree") {
          return (
            <ExteriorTree
              key={`exterior-tree-${index}`}
              position={prop.position}
              scale={prop.scale}
            />
          );
        }
        if (prop.type === "bench") {
          return (
            <ExteriorBench
              key={`exterior-bench-${index}`}
              position={prop.position}
              rotation={prop.rotation}
              scale={prop.scale}
            />
          );
        }
        if (prop.type === "lamp") {
          return (
            <ExteriorLamp
              key={`exterior-lamp-${index}`}
              position={prop.position}
              scale={prop.scale}
            />
          );
        }
        return (
          <ExteriorFlowerBed
            key={`exterior-flower-${index}`}
            position={prop.position}
            scale={prop.scale}
          />
        );
      })}
    </group>
  );
}
