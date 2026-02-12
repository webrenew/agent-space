"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, Preload } from "@react-three/drei";
import { Physics, CuboidCollider } from "@react-three/rapier";
import { Office } from "./Office";
import { Player } from "./Player";
import { NPCManager } from "./NPCManager";
import { FlyInCamera } from "./FlyInCamera";
import { InteractionZone } from "./InteractionZone";

function LoadingScreen() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]">
      <div className="text-center">
        <div className="mb-4 text-4xl">🏢</div>
        <div className="text-lg font-medium text-white">
          Loading Agent Space...
        </div>
        <div className="mt-2 h-1 w-48 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-[#4ECDC4]" />
        </div>
      </div>
    </div>
  );
}

export function Scene() {
  return (
    <div className="relative h-screen w-screen">
      <Suspense fallback={<LoadingScreen />}>
        <Canvas
          shadows
          camera={{ fov: 60, near: 0.1, far: 100, position: [0, 8, 12] }}
          className="touch-none"
        >
          <fog attach="fog" args={["#87CEEB", 20, 40]} />

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

          <Environment preset="apartment" />

          <Physics gravity={[0, -9.81, 0]}>
            {/* Ground collider */}
            <CuboidCollider args={[15, 0.1, 12]} position={[0, -0.1, -5]} />

            {/* Wall colliders */}
            <CuboidCollider args={[0.1, 2, 9]} position={[-11, 2, -5]} />
            <CuboidCollider args={[0.1, 2, 9]} position={[11, 2, -5]} />
            <CuboidCollider args={[11, 2, 0.1]} position={[0, 2, -14]} />

            <Office />
            <Player />
            <NPCManager />
            <InteractionZone />
          </Physics>

          <FlyInCamera />
          <Preload all />
        </Canvas>
      </Suspense>
    </div>
  );
}
