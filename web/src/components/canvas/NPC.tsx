"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Group } from "three";
import { MathUtils, Vector3 } from "three";
import type { NPCConfig } from "@/data/npcs";
import { useGameStore } from "@/stores/useGameStore";

const SKIN = "#FFCC99";
const HAIR = "#4A3728";
const EYE = "#22C55E";

interface NPCProps {
  config: NPCConfig;
  playerPosition: [number, number, number];
}

export function NPC({ config, playerPosition }: NPCProps) {
  const group = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  // Reusable Vector3s to avoid GC pressure in useFrame
  const targetVec = useRef(new Vector3());
  const posVec = useRef(new Vector3());
  const openDialog = useGameStore((s) => s.openDialog);
  const activeNPC = useGameStore((s) => s.activeNPC);
  const visitedNPCs = useGameStore((s) => s.visitedNPCs);

  const isVisited = visitedNPCs.has(config.id);

  // Distance to player
  const dx = playerPosition[0] - config.position[0];
  const dz = playerPosition[2] - config.position[2];
  const distance = Math.sqrt(dx * dx + dz * dz);
  const isNearby = distance < 3;
  const isVisible = distance < 5;

  useFrame((_, delta) => {
    if (!group.current) return;

    // Face player when nearby
    if (isNearby) {
      targetVec.current.set(playerPosition[0], 0, playerPosition[2]);
      posVec.current.set(...config.position);
      const angle = Math.atan2(
        targetVec.current.x - posVec.current.x,
        targetVec.current.z - posVec.current.z
      );
      group.current.rotation.y = MathUtils.lerp(
        group.current.rotation.y,
        angle,
        delta * 3
      );
    }

    // Idle animations
    const t = performance.now() / 1000;
    const head = group.current.children[0]; // head group
    const leftArm = group.current.children[3];
    const rightArm = group.current.children[4];

    if (!head || !leftArm || !rightArm) return;

    switch (config.idleAnimation) {
      case "typing":
        leftArm.rotation.x = Math.sin(t * 8) * 0.15 - 1.2;
        rightArm.rotation.x = Math.sin(t * 8 + 1) * 0.15 - 1.2;
        head.rotation.x = Math.sin(t * 2) * 0.05;
        break;
      case "looking":
        head.rotation.y = Math.sin(t * 0.8) * 0.4;
        head.rotation.x = Math.sin(t * 0.5) * 0.1;
        break;
      case "sipping":
        rightArm.rotation.x =
          Math.sin(t * 0.4) > 0.5
            ? MathUtils.lerp(rightArm.rotation.x, -1.8, delta * 2)
            : MathUtils.lerp(rightArm.rotation.x, 0, delta * 2);
        break;
      case "writing":
        rightArm.rotation.x = Math.sin(t * 4) * 0.1 - 1.0;
        rightArm.rotation.z = Math.sin(t * 3) * 0.1;
        head.rotation.x = -0.15;
        break;
      case "chatting":
        group.current.rotation.z = Math.sin(t * 1.5) * 0.03;
        head.rotation.y = Math.sin(t * 2) * 0.15;
        break;
      case "drawing":
        rightArm.rotation.x = -1.4 + Math.sin(t * 2) * 0.2;
        rightArm.rotation.z = Math.sin(t * 1.5) * 0.15;
        head.rotation.x = Math.sin(t * 0.8) * 0.1 - 0.1;
        break;
    }
  });

  function handleClick() {
    if (isNearby && !activeNPC) {
      openDialog(config.id);
    }
  }

  return (
    <group position={config.position} rotation={config.rotation}>
      <group
        ref={group}
        onClick={handleClick}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        {/* Head */}
        <group position={[0, 1.6, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.8, 0.8, 0.8]} />
            <meshStandardMaterial color={SKIN} />
          </mesh>
          {/* Eyes */}
          <mesh position={[-0.18, 0.05, 0.41]}>
            <boxGeometry args={[0.12, 0.12, 0.02]} />
            <meshStandardMaterial color={EYE} emissive={EYE} emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[0.18, 0.05, 0.41]}>
            <boxGeometry args={[0.12, 0.12, 0.02]} />
            <meshStandardMaterial color={EYE} emissive={EYE} emissiveIntensity={0.5} />
          </mesh>
          {/* Mouth */}
          <mesh position={[0, -0.15, 0.41]}>
            <boxGeometry args={[0.2, 0.05, 0.02]} />
            <meshStandardMaterial color="#8B5E3C" />
          </mesh>
          {/* Hair */}
          <mesh position={[0, 0.35, -0.05]} castShadow>
            <boxGeometry args={[0.85, 0.2, 0.9]} />
            <meshStandardMaterial color={HAIR} />
          </mesh>
        </group>

        {/* Body */}
        <mesh position={[0, 0.9, 0]} castShadow>
          <boxGeometry args={[0.8, 1, 0.5]} />
          <meshStandardMaterial
            color={config.color}
            emissive={hovered && isNearby ? config.color : "#000000"}
            emissiveIntensity={hovered && isNearby ? 0.3 : 0}
          />
        </mesh>

        {/* Legs */}
        <mesh position={[-0.2, 0.3, 0]} castShadow>
          <boxGeometry args={[0.3, 0.6, 0.3]} />
          <meshStandardMaterial color="#2D3748" />
        </mesh>
        <mesh position={[0.2, 0.3, 0]} castShadow>
          <boxGeometry args={[0.3, 0.6, 0.3]} />
          <meshStandardMaterial color="#2D3748" />
        </mesh>

        {/* Left Arm */}
        <group position={[-0.55, 1.1, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.25, 0.8, 0.25]} />
            <meshStandardMaterial color={config.color} />
          </mesh>
        </group>

        {/* Right Arm */}
        <group position={[0.55, 1.1, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.25, 0.8, 0.25]} />
            <meshStandardMaterial color={config.color} />
          </mesh>
        </group>

        {/* Name tag — visible within 5 units */}
        {isVisible && (
          <Html position={[0, 2.3, 0]} center distanceFactor={8} zIndexRange={[0, 0]}>
            <div className="pointer-events-none select-none text-center whitespace-nowrap">
              <div className="text-sm font-bold text-white drop-shadow-lg">
                {config.name}
              </div>
              <div className="text-xs text-white/70">{config.role}</div>
            </div>
          </Html>
        )}

        {/* Speech bubble when nearby */}
        {isNearby && !activeNPC && (
          <Html position={[0, 2.6, 0]} center zIndexRange={[0, 0]}>
            <div
              className={`pointer-events-none text-2xl animate-bounce ${
                isVisited ? "opacity-50" : ""
              }`}
            >
              💬
            </div>
          </Html>
        )}
      </group>
    </group>
  );
}
