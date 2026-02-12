"use client";

import { useEffect, useRef } from "react";

interface Keys {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

export function usePlayerControls() {
  const keys = useRef<Keys>({
    forward: false,
    backward: false,
    left: false,
    right: false,
  });

  useEffect(() => {
    const keyMap: Record<string, keyof Keys> = {
      KeyW: "forward",
      ArrowUp: "forward",
      KeyS: "backward",
      ArrowDown: "backward",
      KeyA: "left",
      ArrowLeft: "left",
      KeyD: "right",
      ArrowRight: "right",
    };

    function onKeyDown(e: KeyboardEvent) {
      const action = keyMap[e.code];
      if (action) {
        keys.current[action] = true;
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      const action = keyMap[e.code];
      if (action) {
        keys.current[action] = false;
      }
    }

    function onBlur() {
      keys.current = {
        forward: false,
        backward: false,
        left: false,
        right: false,
      };
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return keys;
}
