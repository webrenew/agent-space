"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useGameStore } from "@/stores/useGameStore";

export function IntroOverlay() {
  const showIntro = useGameStore((s) => s.showIntro);
  const introComplete = useGameStore((s) => s.introComplete);
  const dismissIntro = useGameStore((s) => s.dismissIntro);

  const visible = showIntro && introComplete;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="fixed inset-0 z-40 flex items-center justify-center"
          onClick={dismissIntro}
        >
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="max-w-md rounded-2xl border border-white/10 bg-black/70 p-8 text-center backdrop-blur-xl"
          >
            <div className="mb-4 text-4xl">🏢</div>
            <h2 className="mb-2 text-2xl font-bold text-white">
              Welcome to Agent Space
            </h2>
            <p className="mb-6 text-white/70">
              Walk around the office and meet the team. Each character will tell
              you about a different feature.
            </p>
            <div className="mb-4 flex items-center justify-center gap-4 text-sm text-white/50">
              <span className="rounded-md border border-white/20 px-2 py-1 font-mono">
                WASD
              </span>
              <span>to move</span>
              <span className="text-white/30">•</span>
              <span className="rounded-md border border-white/20 px-2 py-1 font-mono">
                Click
              </span>
              <span>to interact</span>
            </div>
            <button
              onClick={dismissIntro}
              className="rounded-lg bg-[#4ECDC4] px-6 py-2.5 font-medium text-black transition hover:bg-[#45B7D1]"
            >
              Start Exploring
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
