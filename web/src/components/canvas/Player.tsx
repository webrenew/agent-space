"use client";

import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { Vector3 } from "three";
import { usePlayerControls } from "@/hooks/usePlayerControls";
import { useGameStore } from "@/stores/useGameStore";

const SPEED = 4;
const CAMERA_OFFSET = new Vector3(0, 4, 5);
const Y_AXIS = new Vector3(0, 1, 0);

const SKIN = "#FFCC99";
const SHIRT = "#6366F1";

export function Player() {
  const rigidBody = useRef<RapierRigidBody>(null);
  const keys = usePlayerControls();
  const { camera, gl } = useThree();
  const setPlayerPosition = useGameStore((s) => s.setPlayerPosition);
  const activeNPC = useGameStore((s) => s.activeNPC);
  const introComplete = useGameStore((s) => s.introComplete);

  const yaw = useRef(0);
  const activeNPCRef = useRef(activeNPC);
  const introCompleteRef = useRef(introComplete);
  activeNPCRef.current = activeNPC;
  introCompleteRef.current = introComplete;

  // Reusable Vector3s for useFrame (avoid GC pressure)
  const tempVec = useRef(new Vector3());
  const targetVec = useRef(new Vector3());

  useEffect(() => {
    function onClick() {
      if (!activeNPCRef.current && introCompleteRef.current) {
        gl.domElement.requestPointerLock?.();
      }
    }

    function onMouseMove(e: MouseEvent) {
      if (document.pointerLockElement === gl.domElement) {
        yaw.current -= e.movementX * 0.002;
      }
    }

    gl.domElement.addEventListener("click", onClick);
    document.addEventListener("mousemove", onMouseMove);
    return () => {
      gl.domElement.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMouseMove);
    };
  }, [gl]);

  useFrame(() => {
    if (!rigidBody.current || !introComplete) return;

    // Don't move during dialog
    if (activeNPC) {
      rigidBody.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    const { forward, backward, left, right } = keys.current;

    const moveX = (right ? 1 : 0) - (left ? 1 : 0);
    const moveZ = (backward ? 1 : 0) - (forward ? 1 : 0);

    const sin = Math.sin(yaw.current);
    const cos = Math.cos(yaw.current);

    const velX = (moveX * cos - moveZ * sin) * SPEED;
    const velZ = (moveX * sin + moveZ * cos) * SPEED;

    const currentVel = rigidBody.current.linvel();
    rigidBody.current.setLinvel({ x: velX, y: currentVel.y, z: velZ }, true);

    // Update store + camera
    const pos = rigidBody.current.translation();
    setPlayerPosition([pos.x, pos.y, pos.z]);

    // Third-person camera follow (reuse vectors)
    tempVec.current.copy(CAMERA_OFFSET);
    tempVec.current.applyAxisAngle(Y_AXIS, yaw.current);

    targetVec.current.set(
      pos.x + tempVec.current.x,
      pos.y + tempVec.current.y,
      pos.z + tempVec.current.z
    );
    camera.position.lerp(targetVec.current, 0.1);
    camera.lookAt(pos.x, pos.y + 1.2, pos.z);
  });

  return (
    <RigidBody
      ref={rigidBody}
      position={[0, 1, 2]}
      enabledRotations={[false, false, false]}
      mass={1}
      lockRotations
      colliders="cuboid"
    >
      <group>
        {/* Head */}
        <mesh position={[0, 1.6, 0]} castShadow>
          <boxGeometry args={[0.7, 0.7, 0.7]} />
          <meshStandardMaterial color={SKIN} />
        </mesh>
        {/* Body */}
        <mesh position={[0, 0.9, 0]} castShadow>
          <boxGeometry args={[0.7, 0.9, 0.45]} />
          <meshStandardMaterial color={SHIRT} />
        </mesh>
        {/* Legs */}
        <mesh position={[-0.18, 0.3, 0]} castShadow>
          <boxGeometry args={[0.28, 0.6, 0.28]} />
          <meshStandardMaterial color="#2D3748" />
        </mesh>
        <mesh position={[0.18, 0.3, 0]} castShadow>
          <boxGeometry args={[0.28, 0.6, 0.28]} />
          <meshStandardMaterial color="#2D3748" />
        </mesh>
      </group>
    </RigidBody>
  );
}
