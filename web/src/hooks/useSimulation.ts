import { useEffect } from "react";
import { useDemoStore } from "@/stores/useDemoStore";
import { simulateStep } from "@/lib/simulation";
import type { Agent } from "@/types";

const TICK_MS = 900;
const CELEBRATION_DURATION_MS = 4000;

export function useSimulation() {
  const updateAgent = useDemoStore((s) => s.updateAgent);
  const addToast = useDemoStore((s) => s.addToast);

  useEffect(() => {
    const id = setInterval(() => {
      const agents = useDemoStore.getState().agents;
      const now = Date.now();

      // Auto-clear expired celebrations
      for (const agent of agents) {
        if (
          agent.activeCelebration &&
          agent.celebrationStartedAt &&
          now - agent.celebrationStartedAt > CELEBRATION_DURATION_MS
        ) {
          updateAgent(agent.id, {
            activeCelebration: null,
            celebrationStartedAt: null,
          });
        }
      }

      const { agentUpdates, toasts } = simulateStep(agents, now);

      // Merge updates per agent so later changes don't overwrite earlier ones
      const merged = new Map<string, Partial<Agent>>();
      for (const { id, changes } of agentUpdates) {
        const existing = merged.get(id) ?? {};
        merged.set(id, { ...existing, ...changes });
      }
      for (const [agentId, changes] of merged) {
        updateAgent(agentId, changes);
      }
      for (const toast of toasts) {
        addToast(toast);
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, [updateAgent, addToast]);
}
