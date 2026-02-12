import { create } from "zustand";

interface GameState {
  // Player
  playerPosition: [number, number, number];
  setPlayerPosition: (pos: [number, number, number]) => void;

  // Dialog
  activeNPC: string | null;
  dialogStep: number;
  openDialog: (npcId: string) => void;
  advanceDialog: () => void;
  closeDialog: () => void;

  // Progress
  visitedNPCs: Set<string>;
  markVisited: (npcId: string) => void;

  // UI
  showIntro: boolean;
  dismissIntro: () => void;
  introComplete: boolean;
  setIntroComplete: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  // Player
  playerPosition: [0, 1, 2],
  setPlayerPosition: (pos) => set({ playerPosition: pos }),

  // Dialog
  activeNPC: null,
  dialogStep: 0,
  openDialog: (npcId) =>
    set((state) => {
      const next = new Set(state.visitedNPCs);
      next.add(npcId);
      return {
        activeNPC: npcId,
        dialogStep: 0,
        visitedNPCs: next,
      };
    }),
  advanceDialog: () => set((state) => ({ dialogStep: state.dialogStep + 1 })),
  closeDialog: () => set({ activeNPC: null, dialogStep: 0 }),

  // Progress
  visitedNPCs: new Set<string>(),
  markVisited: (npcId) =>
    set((state) => {
      const next = new Set(state.visitedNPCs);
      next.add(npcId);
      return { visitedNPCs: next };
    }),

  // UI
  showIntro: true,
  dismissIntro: () => set({ showIntro: false }),
  introComplete: false,
  setIntroComplete: () => set({ introComplete: true }),
}));
