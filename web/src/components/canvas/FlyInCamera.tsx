"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { useGameStore } from "@/stores/useGameStore";

const START = new Vector3(0, 8, 12);
const END = new Vector3(0, 5, 7);
const LOOK_AT = new Vector3(0, 1, -5);
const DURATION = 3;

export function FlyInCamera() {
  const { camera } = useThree();
  const elapsed = useRef(0);
  const setIntroComplete = useGameStore((s) => s.setIntroComplete);
  const introComplete = useGameStore((s) => s.introComplete);

  useFrame((_, delta) => {
    if (introComplete) return;

    elapsed.current += delta;
    const t = Math.min(elapsed.current / DURATION, 1);

    // Smooth ease-out
    const ease = 1 - Math.pow(1 - t, 3);

    camera.position.lerpVectors(START, END, ease);
    camera.lookAt(LOOK_AT);

    if (t >= 1) {
      setIntroComplete();
    }
  });

  return null;
}
