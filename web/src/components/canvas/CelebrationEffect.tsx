"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import type { InstancedMesh } from "three";
import { Object3D, Color, MathUtils } from "three";
import type { CelebrationType } from "@/types";

const PARTICLE_COUNT = 40;
const DURATION = 4; // seconds

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: Color;
  scale: number;
}

function makeParticles(type: CelebrationType): Particle[] {
  const confettiColors = [
    "#facc15", "#4ade80", "#a78bfa", "#fb923c", "#f87171",
    "#22d3ee", "#e879f9", "#34d399",
  ];
  const errorColors = ["#ef4444", "#f97316", "#fbbf24"];

  const colors = type === "confetti" ? confettiColors : errorColors;
  const spread = type === "confetti" ? 2.5 : 1.5;
  const upForce = type === "confetti" ? 4 : 2;

  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: (Math.random() - 0.5) * 0.3,
    y: 1.5 + Math.random() * 0.5,
    z: (Math.random() - 0.5) * 0.3,
    vx: (Math.random() - 0.5) * spread,
    vy: Math.random() * upForce + 1,
    vz: (Math.random() - 0.5) * spread,
    color: new Color(colors[Math.floor(Math.random() * colors.length)]),
    scale: 0.04 + Math.random() * 0.06,
  }));
}

const dummy = new Object3D();

interface CelebrationEffectProps {
  type: CelebrationType;
  startedAt: number;
  position: [number, number, number];
}

export function CelebrationEffect({
  type,
  startedAt,
  position,
}: CelebrationEffectProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const particles = useMemo(() => makeParticles(type), [type]);

  useFrame(() => {
    if (!meshRef.current) return;
    const elapsed = (Date.now() - startedAt) / 1000;
    if (elapsed > DURATION) {
      meshRef.current.visible = false;
      return;
    }

    const progress = elapsed / DURATION;
    const gravity = -6;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = particles[i];
      const t = elapsed;

      dummy.position.set(
        p.x + p.vx * t,
        p.y + p.vy * t + 0.5 * gravity * t * t,
        p.z + p.vz * t
      );

      const s = p.scale * MathUtils.lerp(1, 0, Math.max(0, progress - 0.5) * 2);
      dummy.scale.setScalar(s);
      dummy.rotation.set(t * 3 + i, t * 2 + i * 0.5, t + i * 0.3);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      meshRef.current.setColorAt(i, p.color);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group position={position}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
