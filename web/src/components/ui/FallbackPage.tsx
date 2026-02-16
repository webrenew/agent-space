"use client";

import { AGENT_SPACE_INSTALLER_URL } from "@/lib/downloads";

const FEATURES = [
  {
    name: "Desktop-grade HUD",
    role: "Unified Status Language",
    color: "#548C5A",
    text: "The web view uses the same status surfaces, color semantics, and monitoring cadence as the desktop app.",
  },
  {
    name: "Live Agent Telemetry",
    role: "Token + Task Flow",
    color: "#d4a040",
    text: "Track active states, token rates, and task transitions in real time without switching contexts.",
  },
  {
    name: "Project Scope Context",
    role: "Workspace Awareness",
    color: "#c87830",
    text: "Directory-scoped sessions and context continuity keep each agent conversation grounded to its project.",
  },
];

export function FallbackPage() {
  return (
    <div className="min-h-screen bg-[#0e0e0d] px-4 py-20 md:px-6">
      <div className="mx-auto max-w-5xl">
        <div
          className="glass-panel"
          style={{
            borderRadius: 12,
            border: "1px solid rgba(89,86,83,0.25)",
            padding: "20px 18px",
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16, letterSpacing: 1 }}>⬢</span>
            <span
              className="glow-amber"
              style={{ color: "#9A9692", fontSize: 15, fontWeight: 600 }}
            >
              Agent Observer
            </span>
          </div>
          <h1
            style={{
              margin: "12px 0 8px",
              color: "#9A9692",
              fontSize: "clamp(24px, 4vw, 40px)",
              lineHeight: 1.15,
              letterSpacing: -0.4,
            }}
          >
            WebGL is unavailable in this browser.
          </h1>
          <p style={{ margin: 0, color: "#74747C", fontSize: 13, maxWidth: 720 }}>
            The interactive office scene needs WebGL. You can still review the
            product capabilities and continue in the desktop app experience.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.name}
              className="glass-panel hover-row"
              style={{
                borderRadius: 10,
                border: "1px solid rgba(89,86,83,0.24)",
                padding: "12px 12px 10px",
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 2,
                  borderRadius: 2,
                  background: feature.color,
                  marginBottom: 10,
                }}
              />
              <h3
                style={{ margin: "0 0 4px", color: "#9A9692", fontSize: 14, fontWeight: 600 }}
              >
                {feature.name}
              </h3>
              <p
                style={{
                  margin: "0 0 8px",
                  color: "#595653",
                  fontSize: 10,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                }}
              >
                {feature.role}
              </p>
              <p style={{ margin: 0, color: "#74747C", fontSize: 12, lineHeight: 1.5 }}>
                {feature.text}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-10">
          <a
            href={AGENT_SPACE_INSTALLER_URL}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(84,140,90,0.18)",
              border: "1px solid rgba(84,140,90,0.4)",
              color: "#7fb887",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Download macOS app (.dmg) →
          </a>
          <a
            href="#download"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid rgba(212,160,64,0.34)",
              color: "#d4a040",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Install steps ↓
          </a>
          <span style={{ color: "#595653", fontSize: 11 }}>
            macOS (Apple Silicon) installer.
          </span>
          <span style={{ color: "#595653", fontSize: 11 }}>
            Tip: enable hardware acceleration or open in a WebGL-capable browser.
          </span>
        </div>
      </div>
    </div>
  );
}
