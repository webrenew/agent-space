"use client";

import { useMemo } from "react";
import { useDemoStore } from "@/stores/useDemoStore";
import type { AgentStatus } from "@/types";
import { resolveOfficeDeskLayout } from "@/lib/office-layout";
import { resolveWorldTierConfig } from "@/lib/world-tier-config";

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: "#94a3b8",
  thinking: "#facc15",
  streaming: "#4ade80",
  tool_calling: "#a78bfa",
  waiting: "#fb923c",
  error: "#ef4444",
  done: "#22d3ee",
};

const BASE_WORLD_CAPS = resolveWorldTierConfig(0).caps;

const SCALE = 6;
const MAP_W = 130;
const MAP_H = 100;
const OFFSET_X = MAP_W / 2;
const OFFSET_Z = MAP_H / 2 - 15;

function worldToMap(x: number, z: number) {
  return {
    left: x * SCALE + OFFSET_X,
    top: -z * SCALE + OFFSET_Z,
  };
}

export function Minimap() {
  const agents = useDemoStore((s) => s.agents);
  const deskMap = useMemo(
    () =>
      resolveOfficeDeskLayout(Math.max(BASE_WORLD_CAPS.maxDesks, agents.length)).map((desk) => [
        desk.position[0],
        desk.position[2],
      ]),
    [agents.length]
  );

  return (
    <div
      className="relative"
      style={{
        height: 100,
        width: 130,
        overflow: "hidden",
        borderRadius: 8,
        border: "1px solid rgba(89,86,83,0.28)",
        background:
          "linear-gradient(180deg, rgba(26,26,25,0.9) 0%, rgba(14,14,13,0.92) 100%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(89,86,83,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(89,86,83,0.12) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
          opacity: 0.4,
          pointerEvents: "none",
        }}
      />
      {/* Office outline */}
      <div
        className="absolute"
        style={{
          left: worldToMap(-11, 4).left,
          top: worldToMap(0, 4).top,
          width: 22 * SCALE,
          height: 18 * SCALE,
          border: "1px solid rgba(154,150,146,0.28)",
          boxShadow: "inset 0 0 0 1px rgba(89,86,83,0.2)",
        }}
      />

      {/* Agent dots at desk positions */}
      {agents.map((agent) => {
        const desk = deskMap[agent.deskIndex];
        if (!desk) return null;
        const pos = worldToMap(desk[0], desk[1]);
        const color = STATUS_COLOR[agent.status];
        const pulsing =
          agent.status === "streaming" ||
          agent.status === "thinking" ||
          agent.status === "tool_calling";

        return (
          <div
            key={agent.id}
            className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              pulsing ? "animate-pulse" : ""
            }`}
            style={{
              left: pos.left,
              top: pos.top,
              backgroundColor: color,
              border: "1px solid rgba(14,14,13,0.55)",
              boxShadow: `0 0 8px ${color}55`,
            }}
            title={`${agent.name}: ${agent.currentTask}`}
          />
        );
      })}
    </div>
  );
}
