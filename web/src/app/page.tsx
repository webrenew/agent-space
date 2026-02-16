"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { HUD } from "@/components/ui/HUD";
import { FallbackPage } from "@/components/ui/FallbackPage";
import { ContentSection } from "@/components/seo/ContentSection";
import { useSimulation } from "@/hooks/useSimulation";
import { useWorldStateSceneTier } from "@/hooks/useWorldStateSceneTier";

const Scene = dynamic(
  () => import("@/components/canvas/Scene").then((m) => m.Scene),
  { ssr: false }
);

function useWebGLSupport() {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl2") || canvas.getContext("webgl");
      setSupported(!!gl);
    } catch {
      setSupported(false);
    }
  }, []);

  return supported;
}

export default function HomePage() {
  const webgl = useWebGLSupport();
  useWorldStateSceneTier();
  useSimulation();

  // Loading state
  if (webgl === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0e0e0d]">
        <div className="glass-panel rounded-md border px-4 py-2 text-sm text-[#9A9692]">
          Booting workspace...
        </div>
      </div>
    );
  }

  // No WebGL fallback
  if (!webgl) {
    return (
      <>
        <FallbackPage />
        <ContentSection />
      </>
    );
  }

  return (
    <main className="bg-[#0e0e0d]">
      {/* 3D Interactive Office */}
      <Scene />

      {/* 2D Overlays */}
      <HUD />

      {/* SEO Content Below Canvas */}
      <ContentSection />
    </main>
  );
}
