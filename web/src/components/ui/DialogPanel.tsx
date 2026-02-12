"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGameStore } from "@/stores/useGameStore";
import { npcs } from "@/data/npcs";

function TypewriterText({ text, onComplete }: { text: string; onComplete: () => void }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      if (i <= text.length) {
        setDisplayed(text.slice(0, i));
      } else {
        clearInterval(interval);
        setDone(true);
        onCompleteRef.current();
      }
    }, 25);
    return () => clearInterval(interval);
  }, [text]);

  return (
    <span>
      {displayed}
      {!done && <span className="typewriter-cursor" />}
    </span>
  );
}

export function DialogPanel() {
  const activeNPC = useGameStore((s) => s.activeNPC);
  const dialogStep = useGameStore((s) => s.dialogStep);
  const advanceDialog = useGameStore((s) => s.advanceDialog);
  const closeDialog = useGameStore((s) => s.closeDialog);
  const [textDone, setTextDone] = useState(false);

  // Release pointer lock when dialog opens
  useEffect(() => {
    if (activeNPC && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [activeNPC]);

  const handleTextComplete = useCallback(() => setTextDone(true), []);

  const npc = npcs.find((n) => n.id === activeNPC);
  if (!npc) return null;

  const currentDialog = npc.dialog[dialogStep];
  if (!currentDialog) return null;

  const isLastStep = dialogStep >= npc.dialog.length - 1;

  function handleNext() {
    if (!textDone) return;
    if (isLastStep) {
      closeDialog();
    } else {
      setTextDone(false);
      advanceDialog();
    }
  }

  return (
    <AnimatePresence>
      {activeNPC && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 md:p-8"
        >
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-black/80 p-6 shadow-2xl backdrop-blur-xl">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-lg"
                  style={{ backgroundColor: npc.color }}
                />
                <div>
                  <div className="font-bold text-white">{npc.name}</div>
                  <div className="text-xs text-white/50">{npc.role}</div>
                </div>
              </div>
              <button
                onClick={closeDialog}
                className="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Dialog text */}
            <div className="mb-6 min-h-[60px] text-base leading-relaxed text-white/90">
              <TypewriterText
                key={`${activeNPC}-${dialogStep}`}
                text={currentDialog.text}
                onComplete={handleTextComplete}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-white/30">
                {dialogStep + 1} / {npc.dialog.length}
              </div>
              <div className="flex gap-3">
                {currentDialog.cta && textDone && (
                  <a
                    href={currentDialog.cta.href}
                    className="rounded-lg bg-[#4ECDC4] px-4 py-2 text-sm font-medium text-black transition hover:bg-[#45B7D1]"
                  >
                    {currentDialog.cta.label}
                  </a>
                )}
                <button
                  onClick={handleNext}
                  disabled={!textDone}
                  className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20 disabled:opacity-30"
                >
                  {isLastStep ? "Close" : "Next →"}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
