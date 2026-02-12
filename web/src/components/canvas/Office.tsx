"use client";

import { useDemoStore } from "@/stores/useDemoStore";
import { AgentCharacter } from "./AgentCharacter";
import { CelebrationEffect } from "./CelebrationEffect";
import type { AgentStatus } from "@/types";

const WALL_COLOR = "#E8E0D8";
const FLOOR_COLOR = "#D4A574";
const DESK_COLOR = "#8B6914";
const MONITOR_COLOR = "#1A1A2E";

const SCREEN_COLORS: Record<AgentStatus, { color: string; emissive: string; intensity: number }> = {
  idle: { color: "#1a1a2e", emissive: "#334155", intensity: 0.1 },
  thinking: { color: "#facc15", emissive: "#facc15", intensity: 0.4 },
  streaming: { color: "#22C55E", emissive: "#22C55E", intensity: 0.5 },
  tool_calling: { color: "#a78bfa", emissive: "#a78bfa", intensity: 0.4 },
  waiting: { color: "#fb923c", emissive: "#fb923c", intensity: 0.3 },
  error: { color: "#ef4444", emissive: "#ef4444", intensity: 0.6 },
  done: { color: "#22d3ee", emissive: "#22d3ee", intensity: 0.3 },
};

/** Desk positions/rotations for up to 4 agents in a 2x2 layout */
const DESK_LAYOUT: Array<{
  position: [number, number, number];
  rotation: [number, number, number];
  facing: [number, number, number];
}> = [
  { position: [-3, 0, -4], rotation: [0, Math.PI, 0], facing: [-3, 0, -4.8] },
  { position: [3, 0, -4], rotation: [0, Math.PI, 0], facing: [3, 0, -4.8] },
  { position: [-3, 0, -8], rotation: [0, Math.PI, 0], facing: [-3, 0, -8.8] },
  { position: [3, 0, -8], rotation: [0, Math.PI, 0], facing: [3, 0, -8.8] },
];

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
}: {
  position: [number, number, number];
}) {
  return (
    <group position={position}>
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

function Plant({
  position,
}: {
  position: [number, number, number];
}) {
  return (
    <group position={position}>
      {/* Pot */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.4, 8]} />
        <meshStandardMaterial color="#8B4513" />
      </mesh>
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

export function Office() {
  const agents = useDemoStore((s) => s.agents);

  return (
    <group>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.2}
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
      <pointLight position={[-4, 3, -4]} intensity={0.3} color="#FFE4B5" />
      <pointLight position={[4, 3, -9]} intensity={0.3} color="#FFE4B5" />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -5]} receiveShadow>
        <planeGeometry args={[22, 18]} />
        <meshStandardMaterial color={FLOOR_COLOR} />
      </mesh>

      {/* Back wall */}
      <mesh position={[0, 2, -14]} receiveShadow>
        <boxGeometry args={[22, 4, 0.2]} />
        <meshStandardMaterial color={WALL_COLOR} />
      </mesh>
      {/* Window cutouts on back wall */}
      {[-5, 0, 5].map((x, i) => (
        <mesh key={i} position={[x, 2.5, -13.89]}>
          <boxGeometry args={[2, 1.5, 0.05]} />
          <meshStandardMaterial
            color="#87CEEB"
            emissive="#87CEEB"
            emissiveIntensity={0.3}
          />
        </mesh>
      ))}

      {/* Left wall */}
      <mesh position={[-11, 2, -5]} receiveShadow>
        <boxGeometry args={[0.2, 4, 18]} />
        <meshStandardMaterial color={WALL_COLOR} />
      </mesh>

      {/* Right wall */}
      <mesh position={[11, 2, -5]} receiveShadow>
        <boxGeometry args={[0.2, 4, 18]} />
        <meshStandardMaterial color={WALL_COLOR} />
      </mesh>

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
      {agents.map((agent) => {
        const layout = DESK_LAYOUT[agent.deskIndex];
        if (!layout) return null;
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
              rotation={layout.rotation}
            />
            {agent.activeCelebration && agent.celebrationStartedAt && (
              <CelebrationEffect
                type={agent.activeCelebration}
                startedAt={agent.celebrationStartedAt}
                position={layout.position}
              />
            )}
          </group>
        );
      })}

      {/* Monitor wall */}
      <MonitorWall position={[10.8, 0, -3]} />

      {/* Task board */}
      <TaskBoard position={[0, 1.8, -13.85]} />

      {/* Bookshelf */}
      <Bookshelf position={[-6, 1.1, -13.7]} />

      {/* Coffee station */}
      <CoffeeStation position={[6, 0, -12]} />

      {/* Server rack */}
      <ServerRack position={[9.5, 1, -12]} />

      {/* Plants in corners */}
      <Plant position={[-10, 0, -13]} />
      <Plant position={[10, 0, -13]} />
      <Plant position={[-10, 0, 3]} />
      <Plant position={[10, 0, 3]} />

      {/* Whiteboard */}
      <group position={[2, 1.5, -13.85]}>
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
    </group>
  );
}
