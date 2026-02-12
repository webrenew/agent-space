"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { DialogPanel } from "@/components/ui/DialogPanel";
import { HUD } from "@/components/ui/HUD";
import { IntroOverlay } from "@/components/ui/IntroOverlay";
import { FallbackPage } from "@/components/ui/FallbackPage";
import { ContentSection } from "@/components/seo/ContentSection";

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

  // Loading state
  if (webgl === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="text-lg text-white/50">Loading...</div>
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
    <main>
      {/* 3D Interactive Office */}
      <Scene />

      {/* 2D Overlays */}
      <HUD />
      <IntroOverlay />
      <DialogPanel />

      {/* SEO Content Below Canvas */}
      <ContentSection />
    </main>
  );
}
