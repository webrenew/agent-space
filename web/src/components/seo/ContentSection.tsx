import { AGENT_SPACE_INSTALLER_URL } from "@/lib/downloads";
import Link from "next/link";

const FEATURES = [
  {
    id: "dispatcher",
    icon: "01",
    name: "The Dispatcher",
    role: "Operations Lead",
    color: "#548C5A",
    text: "Track every agent running across Cursor, Claude Code, and custom scripts in one mission console.",
    cta: { label: "See workflow", href: "/docs/overview" },
  },
  {
    id: "watcher",
    icon: "02",
    name: "The Watcher",
    role: "Observability Engineer",
    color: "#d4a040",
    text: "Inspect live token usage, error spikes, and task state changes without context switching.",
    cta: { label: "Explore monitoring", href: "/docs/monitoring" },
  },
  {
    id: "builder",
    icon: "03",
    name: "The Builder",
    role: "Developer Advocate",
    color: "#9A9692",
    text: "Install quickly, connect existing workflows, and turn every local run into visible team activity.",
    cta: { label: "Quick start", href: "/docs/quickstart" },
  },
  {
    id: "librarian",
    icon: "04",
    name: "The Librarian",
    role: "Knowledge Architect",
    color: "#74747C",
    text: "Preserve context from agent work so decisions, outputs, and breadcrumbs remain searchable.",
    cta: { label: "Memory model", href: "/docs/memory" },
  },
  {
    id: "messenger",
    icon: "05",
    name: "The Messenger",
    role: "Integration Specialist",
    color: "#c87830",
    text: "Push high-signal updates to Slack, Discord, and webhooks when meaningful events happen.",
    cta: { label: "Integrations", href: "/docs/integrations" },
  },
  {
    id: "architect",
    icon: "06",
    name: "The Architect",
    role: "System Designer",
    color: "#c45050",
    text: "Add an observability layer with low overhead while keeping your current dev environment intact.",
    cta: { label: "Architecture", href: "/docs/architecture" },
  },
];

export function ContentSection() {
  return (
    <section id="features" className="bg-[#0e0e0d] px-4 py-20 md:px-6 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div
          className="glass-panel"
          style={{
            borderRadius: 12,
            padding: "18px 18px 16px",
            border: "1px solid rgba(89,86,83,0.25)",
            marginBottom: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, letterSpacing: 1 }}>⬢</span>
              <span
                style={{
                  color: "#74747C",
                  fontSize: 10,
                  letterSpacing: 1,
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                Product Overview
              </span>
            </div>
            <Link
              href="/docs/quickstart"
              className="nav-item"
              style={{ color: "#548C5A", fontSize: 12, fontWeight: 600 }}
            >
              Open docs →
            </Link>
          </div>

          <h2
            style={{
              color: "#9A9692",
              fontSize: "clamp(24px, 4.4vw, 42px)",
              lineHeight: 1.15,
              margin: "14px 0 10px",
              letterSpacing: -0.5,
            }}
          >
            Agent Observer mirrors the desktop mission-control UI on the web.
          </h2>
          <p
            style={{
              margin: 0,
              color: "#74747C",
              fontSize: "clamp(13px, 1.8vw, 16px)",
              maxWidth: 820,
            }}
          >
            Same status language, same control surfaces, same visual system. Run
            the web experience and desktop app side-by-side without mental
            remapping.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article
              key={feature.id}
              className="glass-panel hover-row"
              style={{
                borderRadius: 10,
                border: "1px solid rgba(89,86,83,0.24)",
                padding: "12px 12px 10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    minWidth: 24,
                    height: 18,
                    borderRadius: 4,
                    border: `1px solid ${feature.color}66`,
                    color: feature.color,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {feature.icon}
                </span>
                <span
                  style={{
                    width: 26,
                    height: 2,
                    borderRadius: 2,
                    background: feature.color,
                    opacity: 0.8,
                  }}
                />
                <span
                  style={{
                    marginLeft: "auto",
                    color: "#595653",
                    fontSize: 10,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  {feature.role}
                </span>
              </div>
              <h3
                style={{
                  margin: "0 0 6px",
                  fontSize: 15,
                  color: "#9A9692",
                  fontWeight: 600,
                }}
              >
                {feature.name}
              </h3>
              <p
                style={{
                  margin: "0 0 10px",
                  color: "#74747C",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {feature.text}
              </p>
              <Link
                href={feature.cta.href}
                className="nav-item"
                style={{
                  color: feature.color,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {feature.cta.label} →
              </Link>
            </article>
          ))}
        </div>

        <div
          id="download"
          className="glass-panel mt-8"
          style={{
            borderRadius: 12,
            border: "1px solid rgba(84,140,90,0.32)",
            padding: "18px 18px 16px",
            background:
              "linear-gradient(180deg, rgba(20,24,21,0.92), rgba(12,14,13,0.9)), radial-gradient(circle at 85% 10%, rgba(84,140,90,0.18), transparent 40%)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, letterSpacing: 1 }}>⬢</span>
              <span
                style={{
                  color: "#7fb887",
                  fontSize: 10,
                  letterSpacing: 1,
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                Desktop Install
              </span>
            </div>
            <span style={{ color: "#595653", fontSize: 11 }}>
              Current packaged target: macOS (Apple Silicon)
            </span>
          </div>

          <h3
            style={{
              margin: "0 0 8px",
              color: "#9A9692",
              fontSize: "clamp(18px, 2.8vw, 28px)",
              lineHeight: 1.2,
            }}
          >
            Download Agent Observer and install in under a minute.
          </h3>
          <p
            style={{
              margin: "0 0 12px",
              color: "#74747C",
              fontSize: "clamp(12px, 1.7vw, 14px)",
              maxWidth: 880,
            }}
          >
            Download the latest installer directly from this site, open the DMG,
            and drag Agent Observer into your Applications folder.
          </p>

          <div className="flex flex-wrap items-center gap-8">
            <a
              href={AGENT_SPACE_INSTALLER_URL}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                background: "rgba(84,140,90,0.2)",
                border: "1px solid rgba(84,140,90,0.42)",
                color: "#7fb887",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Download latest build →
            </a>
            <a
              href="#install-checklist"
              className="nav-item"
              style={{ color: "#d4a040", fontSize: 12, fontWeight: 600 }}
            >
              View install checklist ↓
            </a>
          </div>

          <ol
            id="install-checklist"
            style={{
              margin: "14px 0 0",
              paddingLeft: 18,
              color: "#74747C",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            <li>Use the website installer link to download the latest `.dmg`.</li>
            <li>Open the DMG, then drag Agent Observer into `Applications`.</li>
            <li>Launch Agent Observer from Applications and approve requested permissions.</li>
          </ol>
        </div>
      </div>
    </section>
  );
}
