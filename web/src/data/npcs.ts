export interface NPCDialog {
  speaker: string;
  text: string;
  cta?: { label: string; href: string };
}

export interface NPCConfig {
  id: string;
  name: string;
  role: string;
  color: string;
  position: [number, number, number];
  rotation: [number, number, number];
  idleAnimation:
    | "typing"
    | "looking"
    | "sipping"
    | "writing"
    | "chatting"
    | "drawing";
  dialog: NPCDialog[];
}

export const npcs: NPCConfig[] = [
  {
    id: "dispatcher",
    name: "The Dispatcher",
    role: "Operations Lead",
    color: "#FF6B35",
    position: [0, 0, -5],
    rotation: [0, Math.PI, 0],
    idleAnimation: "writing",
    dialog: [
      {
        speaker: "The Dispatcher",
        text: "Welcome to Agent Space! I keep track of every agent running across your tools — Cursor, Claude Code, custom scripts — all of them, in one place.",
      },
      {
        speaker: "The Dispatcher",
        text: "Think of me as mission control. I see every task, every spawn, every completion. No agent goes unnoticed.",
        cta: { label: "See how it works →", href: "/docs/overview" },
      },
    ],
  },
  {
    id: "watcher",
    name: "The Watcher",
    role: "Observability Engineer",
    color: "#4ECDC4",
    position: [6, 0, -3],
    rotation: [0, -Math.PI / 2, 0],
    idleAnimation: "looking",
    dialog: [
      {
        speaker: "The Watcher",
        text: "I monitor everything in real-time. Token usage, error rates, task duration — all streaming live to these screens.",
      },
      {
        speaker: "The Watcher",
        text: "You get logs, traces, and metrics for every agent operation. Spot bottlenecks before they become problems.",
        cta: { label: "Explore monitoring →", href: "/docs/monitoring" },
      },
    ],
  },
  {
    id: "builder",
    name: "The Builder",
    role: "Developer Advocate",
    color: "#45B7D1",
    position: [-6, 0, -2],
    rotation: [0, Math.PI / 2, 0],
    idleAnimation: "typing",
    dialog: [
      {
        speaker: "The Builder",
        text: "Getting started? It's just an npm install and a few lines of config. I integrate with any agent framework.",
      },
      {
        speaker: "The Builder",
        text: "MCP server, CLI tool, or SDK — pick your flavor. Five minutes to first dashboard.",
        cta: { label: "Quick start guide →", href: "/docs/quickstart" },
      },
    ],
  },
  {
    id: "librarian",
    name: "The Librarian",
    role: "Knowledge Architect",
    color: "#96CEB4",
    position: [-4, 0, -8],
    rotation: [0, 0, 0],
    idleAnimation: "looking",
    dialog: [
      {
        speaker: "The Librarian",
        text: "Every agent interaction generates context. I make sure nothing gets lost — memories, decisions, outputs, all indexed and searchable.",
      },
      {
        speaker: "The Librarian",
        text: "Need to know what an agent decided 3 days ago and why? That's my department.",
        cta: { label: "Learn about memory →", href: "/docs/memory" },
      },
    ],
  },
  {
    id: "messenger",
    name: "The Messenger",
    role: "Integration Specialist",
    color: "#FFEAA7",
    position: [4, 0, -8],
    rotation: [0, Math.PI, 0],
    idleAnimation: "sipping",
    dialog: [
      {
        speaker: "The Messenger",
        text: "I handle all the notifications. Slack, Discord, webhooks — when something important happens, the right people know instantly.",
      },
      {
        speaker: "The Messenger",
        text: "Set up alerts for failures, completions, budget limits — whatever matters to your team.",
        cta: { label: "Set up integrations →", href: "/docs/integrations" },
      },
    ],
  },
  {
    id: "architect",
    name: "The Architect",
    role: "System Designer",
    color: "#DDA0DD",
    position: [0, 0, -10],
    rotation: [0, 0, 0],
    idleAnimation: "drawing",
    dialog: [
      {
        speaker: "The Architect",
        text: "I designed this whole system. Agent Space sits between your agents and your team — a lightweight observation layer with zero performance overhead.",
      },
      {
        speaker: "The Architect",
        text: "Open source core, cloud dashboard optional. Your agents, your data, your rules.",
        cta: { label: "View architecture →", href: "/docs/architecture" },
      },
    ],
  },
];
