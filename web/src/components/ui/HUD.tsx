"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useDemoStore } from "@/stores/useDemoStore";
import { STATUS_LABELS, AGENT_COLORS } from "@/types";
import type { AgentStatus } from "@/types";
import type { CelebrationType } from "@/types";
import { AGENT_SPACE_RELEASES_URL } from "@/lib/downloads";
import { setManualAgentOverride } from "@/lib/simulation";
import { Minimap } from "./Minimap";

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: "#595653",
  thinking: "#c87830",
  streaming: "#d4a040",
  tool_calling: "#d4a040",
  waiting: "#74747C",
  error: "#c45050",
  done: "#548C5A",
};

type OverlayPanel = "agents" | "party" | "minimap";

interface OverlayPanelVisibility {
  agents: boolean;
  party: boolean;
  minimap: boolean;
}

const DEFAULT_OVERLAY_VISIBILITY: OverlayPanelVisibility = {
  agents: true,
  party: true,
  minimap: true,
};

type DesktopPanelTarget =
  | "chat"
  | "terminal"
  | "tokens"
  | "scene3d"
  | "activity"
  | "memoryGraph"
  | "agents"
  | "recentMemories";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function AgentCard({ agentId }: { agentId: string }) {
  const agent = useDemoStore((s) => s.agents.find((a) => a.id === agentId));
  const selectedId = useDemoStore((s) => s.selectedAgentId);
  const selectAgent = useDemoStore((s) => s.selectAgent);

  if (!agent) return null;

  const isSelected = selectedId === agent.id;
  const accent = AGENT_COLORS[agent.agent_type];
  const showPulse =
    agent.status === "thinking" ||
    agent.status === "streaming" ||
    agent.status === "tool_calling";

  return (
    <button
      onClick={() => selectAgent(isSelected ? null : agent.id)}
      className="hover-row"
      style={{
        width: "100%",
        borderRadius: 8,
        border: `1px solid ${isSelected ? `${accent}66` : "rgba(89,86,83,0.22)"}`,
        background: isSelected ? "rgba(89,86,83,0.16)" : "rgba(26,26,25,0.7)",
        padding: "8px 10px",
        textAlign: "left",
        cursor: "pointer",
        color: "#9A9692",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            backgroundColor: accent,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#9A9692",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {agent.name}
        </span>
        <span
          className={showPulse ? "pulse-amber" : undefined}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: STATUS_COLOR[agent.status],
            flexShrink: 0,
          }}
        />
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#74747C",
          marginBottom: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {agent.currentTask}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 10,
          color: "#595653",
        }}
      >
        <span>{formatTokens(agent.tokens_input)} in</span>
        <span>{formatTokens(agent.tokens_output)} out</span>
        <span>{agent.files_modified} files</span>
        <span style={{ color: STATUS_COLOR[agent.status], marginLeft: "auto" }}>
          {STATUS_LABELS[agent.status]}
        </span>
      </div>
    </button>
  );
}

function TopBar({
  activeCount,
  totalTokens,
  agentCount,
  overlayVisibility,
  onToggleOverlay,
  onResetLayout,
}: {
  activeCount: number;
  totalTokens: number;
  agentCount: number;
  overlayVisibility: OverlayPanelVisibility;
  onToggleOverlay: (panel: OverlayPanel) => void;
  onResetLayout: () => void;
}) {
  const agents = useDemoStore((s) => s.agents);
  const selectedAgentId = useDemoStore((s) => s.selectedAgentId);
  const selectAgent = useDemoStore((s) => s.selectAgent);
  const updateAgent = useDemoStore((s) => s.updateAgent);
  const addToast = useDemoStore((s) => s.addToast);
  const isMac = useMemo(
    () => typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC"),
    []
  );
  const modLabel = isMac ? "Cmd" : "Ctrl";
  const devToolsShortcut = isMac ? "⌥⌘I" : "Ctrl+Shift+I";
  const [timeStr, setTimeStr] = useState(() =>
    new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  );
  const [openMenu, setOpenMenu] = useState<"file" | "edit" | "view" | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const dropdownStyle = {
    position: "absolute" as const,
    top: 30,
    left: -8,
    zIndex: 9999,
    minWidth: 220,
    padding: "4px 0",
    borderRadius: 6,
    background: "#1A1A19",
    border: "1px solid rgba(89,86,83,0.3)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
    overflow: "hidden",
  };
  const menuRowStyle = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 12px",
    cursor: "pointer",
    fontSize: 12,
  };

  const panelMenuItems: ReadonlyArray<{
    id: DesktopPanelTarget;
    label: string;
    shortcut: string;
  }> = [
    { id: "chat", label: "Chat", shortcut: `${modLabel}+1` },
    { id: "terminal", label: "Terminal", shortcut: `${modLabel}+2` },
    { id: "tokens", label: "Tokens", shortcut: `${modLabel}+3` },
    { id: "scene3d", label: "Office", shortcut: `${modLabel}+4` },
    { id: "activity", label: "Activity", shortcut: `${modLabel}+5` },
    { id: "memoryGraph", label: "Memory Graph", shortcut: `${modLabel}+6` },
    { id: "agents", label: "Agents", shortcut: `${modLabel}+7` },
    { id: "recentMemories", label: "Recent", shortcut: `${modLabel}+8` },
  ];

  const closeMenus = useCallback(() => {
    setOpenMenu(null);
  }, []);

  const toggleMenu = useCallback((menu: "file" | "edit" | "view") => {
    setOpenMenu((current) => (current === menu ? null : menu));
  }, []);

  const runMenuAction = useCallback(
    (action: () => void | Promise<void>) => {
      closeMenus();
      try {
        const result = action();
        if (result && typeof (result as Promise<unknown>).then === "function") {
          void (result as Promise<unknown>).catch((err) => {
            console.error("[HUD] Menu action failed:", err);
          });
        }
      } catch (err) {
        console.error("[HUD] Menu action failed:", err);
      }
    },
    [closeMenus]
  );

  const showToast = useCallback(
    (message: string, type: "info" | "error" | "success" = "info") => {
      addToast({ type, message });
    },
    [addToast]
  );

  const scrollToId = useCallback((id: string) => {
    const node = document.getElementById(id);
    if (!node) return false;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }, []);

  const applyZoom = useCallback((nextLevel: number) => {
    const clamped = Math.max(0.8, Math.min(1.4, Math.round(nextLevel * 100) / 100));
    document.body.style.zoom = String(clamped);
    setZoomLevel(clamped);
    return clamped;
  }, []);

  const setAgentTask = useCallback(
    (task: string, status: AgentStatus, toastMessage: string) => {
      const selected = selectedAgentId
        ? agents.find((agent) => agent.id === selectedAgentId) ?? null
        : null;
      const target = selected ?? agents[0] ?? null;

      if (!target) {
        showToast("No active agents in the office.", "error");
        return;
      }

      selectAgent(target.id);
      setManualAgentOverride(target.id, task, status);
      updateAgent(target.id, { status, currentTask: task });
      showToast(toastMessage, "success");
    },
    [agents, selectedAgentId, selectAgent, showToast, updateAgent]
  );

  const openFolderDialog = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const onFolderPicked = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) {
        event.target.value = "";
        return;
      }
      const first = files[0];
      const relativePath = first.webkitRelativePath || first.name;
      const folderName = relativePath.split("/").filter(Boolean)[0] ?? "workspace";
      setAgentTask(
        `Indexing ${folderName} workspace`,
        "thinking",
        `Opened folder: ${folderName}`
      );
      event.target.value = "";
    },
    [setAgentTask]
  );

  const openSettings = useCallback(() => {
    scrollToId("features");
    showToast(
      "Web demo settings are limited. Install the desktop app for full controls.",
      "info"
    );
  }, [scrollToId, showToast]);

  const openHelp = useCallback(() => {
    window.open("/docs/quickstart", "_blank", "noopener,noreferrer");
  }, []);

  const focusChatInput = useCallback(() => {
    if (!overlayVisibility.agents) onToggleOverlay("agents");
    const firstAgent = agents[0] ?? null;
    if (!firstAgent) {
      showToast("No agent session to focus.", "error");
      return;
    }
    selectAgent(firstAgent.id);
    showToast("Focused chat context on active agents.", "info");
  }, [agents, onToggleOverlay, overlayVisibility.agents, selectAgent, showToast]);

  const focusPanel = useCallback(
    (panel: DesktopPanelTarget) => {
      if (panel === "chat") {
        focusChatInput();
        return;
      }

      if (panel === "terminal") {
        if (!overlayVisibility.party) onToggleOverlay("party");
        setAgentTask("Running terminal command…", "streaming", "Focused Terminal.");
        return;
      }

      if (panel === "tokens") {
        if (!overlayVisibility.minimap) onToggleOverlay("minimap");
        showToast(`Token telemetry: ${formatTokens(totalTokens)} total tokens`, "info");
        return;
      }

      if (panel === "scene3d") {
        window.scrollTo({ top: 0, behavior: "smooth" });
        showToast("Focused Office scene.", "info");
        return;
      }

      if (panel === "activity") {
        scrollToId("features");
        showToast("Focused Activity stream.", "info");
        return;
      }

      if (panel === "memoryGraph") {
        window.open("/docs/memory", "_blank", "noopener,noreferrer");
        showToast("Opened memory graph docs.", "info");
        return;
      }

      if (panel === "agents") {
        onToggleOverlay("agents");
        showToast(
          overlayVisibility.agents ? "Agents panel hidden." : "Agents panel shown.",
          "info"
        );
        return;
      }

      scrollToId("download");
      showToast("Focused recent/install section.", "info");
    },
    [
      focusChatInput,
      onToggleOverlay,
      overlayVisibility.agents,
      overlayVisibility.minimap,
      overlayVisibility.party,
      scrollToId,
      setAgentTask,
      showToast,
      totalTokens,
    ]
  );

  const runFileSearch = useCallback(() => {
    setAgentTask(
      "Searching files for TODO and FIXME markers",
      "tool_calling",
      "Search Files started."
    );
  }, [setAgentTask]);

  const openFileExplorer = useCallback(() => {
    window.open("/docs/guides/chat-and-files", "_blank", "noopener,noreferrer");
    showToast("Opened file workflow docs (desktop File Explorer lives in app).", "info");
  }, [showToast]);

  const resetLayout = useCallback(() => {
    onResetLayout();
    const level = applyZoom(1);
    showToast(`Layout reset. Zoom ${Math.round(level * 100)}%.`, "success");
  }, [applyZoom, onResetLayout, showToast]);

  const resetZoom = useCallback(() => {
    const level = applyZoom(1);
    showToast(`Zoom reset to ${Math.round(level * 100)}%.`, "info");
  }, [applyZoom, showToast]);

  const zoomIn = useCallback(() => {
    const level = applyZoom(zoomLevel + 0.1);
    showToast(`Zoom ${Math.round(level * 100)}%.`, "info");
  }, [applyZoom, showToast, zoomLevel]);

  const zoomOut = useCallback(() => {
    const level = applyZoom(zoomLevel - 0.1);
    showToast(`Zoom ${Math.round(level * 100)}%.`, "info");
  }, [applyZoom, showToast, zoomLevel]);

  const toggleDevTools = useCallback(() => {
    showToast(`Open browser devtools with ${devToolsShortcut}.`, "info");
  }, [devToolsShortcut, showToast]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        showToast("Entered fullscreen.", "info");
      } else {
        await document.exitFullscreen();
        showToast("Exited fullscreen.", "info");
      }
    } catch {
      showToast("Fullscreen is blocked by this browser context.", "error");
    }
  }, [showToast]);

  const runEditCommand = useCallback(
    (command: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll") => {
      const active = document.activeElement;

      if (command === "selectAll") {
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
          active.focus();
          active.select();
          closeMenus();
          return;
        }
        if (active instanceof HTMLElement && active.isContentEditable) {
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(active);
            selection.removeAllRanges();
            selection.addRange(range);
            closeMenus();
            return;
          }
        }
      }

      try {
        document.execCommand(command);
      } catch (err) {
        console.error(`[HUD] Edit command "${command}" failed:`, err);
      }

      closeMenus();
    },
    [closeMenus]
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeStr(
        new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      );
    }, 60_000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const handler = (event: MouseEvent) => {
      if (menuRootRef.current && !menuRootRef.current.contains(event.target as Node)) {
        closeMenus();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [closeMenus, openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenus();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [closeMenus, openMenu]);

  useEffect(
    () => () => {
      document.body.style.zoom = "1";
    },
    []
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "F1") {
        event.preventDefault();
        openHelp();
        return;
      }
      if (event.key === "F11") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        openFolderDialog();
        return;
      }
      if (event.shiftKey && key === "n") {
        event.preventDefault();
        setAgentTask("Running terminal command…", "streaming", "Started new terminal.");
        return;
      }
      if (key === ",") {
        event.preventDefault();
        openSettings();
        return;
      }
      if (key === "/") {
        event.preventDefault();
        focusChatInput();
        return;
      }
      if (event.shiftKey && key === "r") {
        event.preventDefault();
        resetLayout();
        return;
      }
      if (event.shiftKey && key === "e") {
        event.preventDefault();
        openFileExplorer();
        return;
      }
      if (key === "p") {
        event.preventDefault();
        runFileSearch();
        return;
      }
      if (key === "0") {
        event.preventDefault();
        resetZoom();
        return;
      }
      if (key === "=" || key === "+") {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (key === "-" || key === "_") {
        event.preventDefault();
        zoomOut();
        return;
      }

      const panelByShortcut: Partial<Record<string, DesktopPanelTarget>> = {
        "1": "chat",
        "2": "terminal",
        "3": "tokens",
        "4": "scene3d",
        "5": "activity",
        "6": "memoryGraph",
        "7": "agents",
        "8": "recentMemories",
      };
      const target = panelByShortcut[key];
      if (target) {
        event.preventDefault();
        focusPanel(target);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    focusChatInput,
    focusPanel,
    openFileExplorer,
    openFolderDialog,
    openHelp,
    openSettings,
    resetLayout,
    resetZoom,
    runFileSearch,
    setAgentTask,
    toggleFullscreen,
    zoomIn,
    zoomOut,
  ]);

  return (
    <header
      className="glass-panel"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        borderTop: "none",
        borderLeft: "none",
        borderRight: "none",
        borderBottom: "1px solid rgba(89,86,83,0.22)",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}
      >
        <input
          ref={folderInputRef}
          type="file"
          multiple
          onChange={onFolderPicked}
          style={{ display: "none" }}
        />
        <span style={{ fontSize: 16, letterSpacing: 1 }}>⬢</span>
        <span style={{ color: "#9A9692", fontSize: 12, fontWeight: 500 }}>
          Live Demo
        </span>
        <span style={{ color: "#595653" }}>|</span>
        <nav
          ref={menuRootRef}
          className="hidden items-center gap-14 md:flex"
          style={{ position: "relative" }}
        >
          {openMenu && (
            <div style={{ position: "fixed", inset: 0, zIndex: 9998 }} onClick={closeMenus} />
          )}

          <div style={{ position: "relative", zIndex: 9999 }}>
            <span
              className="nav-item"
              onClick={() => toggleMenu("file")}
              style={{ color: "#74747C", fontSize: 12 }}
            >
              File
            </span>
            {openMenu === "file" && (
              <div style={dropdownStyle}>
                <div
                  onClick={() => runMenuAction(openFolderDialog)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>Open Folder...</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                    {modLabel}+O
                  </span>
                </div>
                <div style={{ height: 1, margin: "4px 6px", background: "rgba(89,86,83,0.25)" }} />
                <div
                  onClick={() =>
                    runMenuAction(() =>
                      setAgentTask("Running terminal command…", "streaming", "Started new terminal.")
                    )
                  }
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>New Terminal</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                    {modLabel}+Shift+N
                  </span>
                </div>
                <div style={{ height: 1, margin: "4px 6px", background: "rgba(89,86,83,0.25)" }} />
                <div
                  onClick={() => runMenuAction(openSettings)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>Settings...</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                    {modLabel}+,
                  </span>
                </div>
                <div
                  onClick={() => runMenuAction(openHelp)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>Help</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>F1</span>
                </div>
              </div>
            )}
          </div>

          <div style={{ position: "relative", zIndex: 9999 }}>
            <span
              className="nav-item"
              onClick={() => toggleMenu("edit")}
              style={{ color: "#74747C", fontSize: 12 }}
            >
              Edit
            </span>
            {openMenu === "edit" && (
              <div style={dropdownStyle}>
                {[
                  { label: "Undo", shortcut: `${modLabel}+Z`, cmd: "undo" as const },
                  { label: "Redo", shortcut: `${modLabel}+Shift+Z`, cmd: "redo" as const },
                ].map((item) => (
                  <div
                    key={item.label}
                    onClick={() => runEditCommand(item.cmd)}
                    className="hover-row"
                    style={menuRowStyle}
                  >
                    <span style={{ color: "#9A9692", flex: 1 }}>{item.label}</span>
                    <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                      {item.shortcut}
                    </span>
                  </div>
                ))}
                <div style={{ height: 1, margin: "4px 6px", background: "rgba(89,86,83,0.25)" }} />
                {[
                  { label: "Cut", shortcut: `${modLabel}+X`, cmd: "cut" as const },
                  { label: "Copy", shortcut: `${modLabel}+C`, cmd: "copy" as const },
                  { label: "Paste", shortcut: `${modLabel}+V`, cmd: "paste" as const },
                  { label: "Select All", shortcut: `${modLabel}+A`, cmd: "selectAll" as const },
                ].map((item) => (
                  <div
                    key={item.label}
                    onClick={() => runEditCommand(item.cmd)}
                    className="hover-row"
                    style={menuRowStyle}
                  >
                    <span style={{ color: "#9A9692", flex: 1 }}>{item.label}</span>
                    <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                      {item.shortcut}
                    </span>
                  </div>
                ))}
                <div style={{ height: 1, margin: "4px 6px", background: "rgba(89,86,83,0.25)" }} />
                <div
                  onClick={() => runMenuAction(focusChatInput)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>Focus Chat Input</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                    {modLabel}+/
                  </span>
                </div>
              </div>
            )}
          </div>

          <div style={{ position: "relative", zIndex: 9999 }}>
            <span
              className="nav-item"
              onClick={() => toggleMenu("view")}
              style={{ color: "#74747C", fontSize: 12 }}
            >
              View
            </span>
            {openMenu === "view" && (
              <div style={dropdownStyle}>
                {panelMenuItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => runMenuAction(() => focusPanel(item.id))}
                    className="hover-row"
                    style={menuRowStyle}
                  >
                    <span style={{ color: "#9A9692", flex: 1 }}>{item.label}</span>
                    <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                      {item.shortcut}
                    </span>
                  </div>
                ))}
                <div style={{ height: 1, margin: "4px 6px", background: "rgba(89,86,83,0.25)" }} />
                <div
                  onClick={() => runMenuAction(runFileSearch)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>Search Files</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                    {modLabel}+P
                  </span>
                </div>
                <div
                  onClick={() => runMenuAction(openFileExplorer)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>File Explorer</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                    {modLabel}+Shift+E
                  </span>
                </div>
                <div style={{ height: 1, margin: "4px 6px", background: "rgba(89,86,83,0.25)" }} />
                <div
                  onClick={() => runMenuAction(resetLayout)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>Reset Layout</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                    {modLabel}+Shift+R
                  </span>
                </div>
                <div style={{ height: 1, margin: "4px 6px", background: "rgba(89,86,83,0.25)" }} />
                <div
                  onClick={() => runMenuAction(toggleDevTools)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>Toggle DevTools</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                    {devToolsShortcut}
                  </span>
                </div>
                <div style={{ height: 1, margin: "4px 6px", background: "rgba(89,86,83,0.25)" }} />
                <div
                  onClick={() => runMenuAction(resetZoom)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>Reset Zoom</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                    {modLabel}+0
                  </span>
                </div>
                <div
                  onClick={() => runMenuAction(zoomIn)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>Zoom In</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                    {modLabel}+=
                  </span>
                </div>
                <div
                  onClick={() => runMenuAction(zoomOut)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>Zoom Out</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>
                    {modLabel}+-
                  </span>
                </div>
                <div style={{ height: 1, margin: "4px 6px", background: "rgba(89,86,83,0.25)" }} />
                <div
                  onClick={() => runMenuAction(toggleFullscreen)}
                  className="hover-row"
                  style={menuRowStyle}
                >
                  <span style={{ color: "#9A9692", flex: 1 }}>Toggle Fullscreen</span>
                  <span style={{ color: "#595653", fontSize: 10, fontWeight: 500 }}>F11</span>
                </div>
              </div>
            )}
          </div>

          <Link
            className="nav-item"
            href="/docs"
            style={{ color: "#74747C", fontSize: 12 }}
          >
            Docs
          </Link>
          <a
            className="nav-item"
            href="#download"
            style={{ color: "#74747C", fontSize: 12 }}
          >
            Install
          </a>
        </nav>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: "#74747C",
          fontSize: 12,
          whiteSpace: "nowrap",
        }}
      >
        <span className="glow-amber hidden md:inline" style={{ color: "#9A9692" }}>
          agent-observer
        </span>
        <span style={{ color: "#595653" }}>|</span>
        <span>
          <strong style={{ color: "#9A9692" }}>{activeCount}</strong>
          <span style={{ color: "#595653" }}>/{agentCount}</span> active
        </span>
        <span style={{ color: "#595653" }}>|</span>
        <span>
          <strong style={{ color: "#9A9692" }}>{formatTokens(totalTokens)}</strong>{" "}
          tokens
        </span>
        <span style={{ color: "#595653" }}>|</span>
        <span style={{ color: "#9A9692" }}>{timeStr}</span>
      </div>
    </header>
  );
}

function ToastStack() {
  const toasts = useDemoStore((s) => s.toasts);
  const removeToast = useDemoStore((s) => s.removeToast);

  useEffect(() => {
    const timeouts = toasts.map((toast) =>
      setTimeout(() => removeToast(toast.id), 4000)
    );
    return () => timeouts.forEach(clearTimeout);
  }, [toasts, removeToast]);

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="glass-panel toast-in"
          style={{
            minWidth: 220,
            borderRadius: 8,
            padding: "7px 12px",
            border:
              toast.type === "error"
                ? "1px solid rgba(196,80,80,0.4)"
                : toast.type === "success"
                  ? "1px solid rgba(84,140,90,0.4)"
                  : "1px solid rgba(212,160,64,0.4)",
            color:
              toast.type === "error"
                ? "#c45050"
                : toast.type === "success"
                  ? "#548C5A"
                  : "#d4a040",
            fontSize: 12,
          }}
        >
          <span style={{ color: "#9A9692" }}>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

interface PartyAction {
  id: CelebrationType;
  label: string;
  note: string;
  accent: string;
}

const PARTY_ACTIONS: PartyAction[] = [
  { id: "pizza_party", label: "Pizza Party", note: "Late-night deploy fuel", accent: "#fbbf24" },
  { id: "floppy_rain", label: "Floppy Rain", note: "3.5-inch victory storm", accent: "#60a5fa" },
  { id: "dialup_wave", label: "Dial-Up Wave", note: "Modem handshake complete", accent: "#a78bfa" },
  { id: "fax_blast", label: "Fax Blast", note: "Paper tray overclocked", accent: "#34d399" },
];
const PARTY_ACTION_DURATION_MS: Record<CelebrationType, number> = {
  confetti: 4000,
  rocket: 3000,
  sparkles: 2500,
  explosion: 2000,
  trophy: 3000,
  pizza_party: 4200,
  floppy_rain: 3800,
  dialup_wave: 3400,
  fax_blast: 3200,
};

function PartyDeck() {
  const agents = useDemoStore((s) => s.agents);
  const selectedAgentId = useDemoStore((s) => s.selectedAgentId);
  const updateAgent = useDemoStore((s) => s.updateAgent);
  const addToast = useDemoStore((s) => s.addToast);

  const selected = agents.find((a) => a.id === selectedAgentId) ?? null;

  const triggerAction = (action: PartyAction) => {
    const targets = selected ? [selected] : agents;
    if (targets.length === 0) {
      addToast({ type: "info", message: "No agents available for party mode" });
      return;
    }

    const startedAt = Date.now();
    targets.forEach((agent, index) => {
      updateAgent(agent.id, {
        activeCelebration: action.id,
        celebrationStartedAt: startedAt + index * 55,
      });
      const duration = PARTY_ACTION_DURATION_MS[action.id] ?? 3500;
      setTimeout(() => {
        const current = useDemoStore.getState().agents.find((entry) => entry.id === agent.id);
        if (!current || current.activeCelebration !== action.id) return;
        useDemoStore.getState().updateAgent(agent.id, {
          activeCelebration: null,
          celebrationStartedAt: null,
        });
      }, duration + index * 60);
    });

    addToast({
      type: "success",
      message: selected
        ? `${selected.name}: ${action.label}`
        : `${action.label} launched for ${targets.length} agents`,
    });
  };

  return (
    <aside className="fixed top-[50px] right-4 z-30 hidden w-[240px] md:block">
      <div
        className="glass-panel"
        style={{
          borderRadius: 10,
          padding: 8,
          border: "1px solid rgba(84,140,90,0.35)",
          background:
            "linear-gradient(180deg, rgba(27,32,28,0.95), rgba(10,12,11,0.9)), repeating-linear-gradient(90deg, rgba(84,140,90,0.06) 0px, rgba(84,140,90,0.06) 1px, transparent 1px, transparent 6px)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            color: "#9A9692",
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          <span>Party Deck</span>
          <span style={{ color: "#595653" }}>
            {selected ? `target ${selected.name}` : "target all"}
          </span>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          {PARTY_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => triggerAction(action)}
              className="hover-row"
              style={{
                width: "100%",
                borderRadius: 7,
                border: `1px solid ${action.accent}66`,
                background: "rgba(10,14,12,0.72)",
                color: "#9A9692",
                padding: "6px 9px",
                textAlign: "left",
                cursor: "pointer",
              }}
              title={action.note}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 1,
                    background: action.accent,
                    boxShadow: `0 0 8px ${action.accent}88`,
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: "#d6d2cd", fontWeight: 600, fontSize: 12 }}>{action.label}</span>
              </div>
              <div style={{ color: "#7f7a74", fontSize: 10, marginTop: 2 }}>{action.note}</div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

export function HUD() {
  const agents = useDemoStore((s) => s.agents);
  const [overlayVisibility, setOverlayVisibility] = useState<OverlayPanelVisibility>({
    ...DEFAULT_OVERLAY_VISIBILITY,
  });

  const { activeCount, totalTokens } = useMemo(() => {
    const active = agents.filter(
      (a) => a.status !== "idle" && a.status !== "done"
    ).length;
    const tokens = agents.reduce(
      (sum, a) => sum + a.tokens_input + a.tokens_output,
      0
    );
    return { activeCount: active, totalTokens: tokens };
  }, [agents]);

  const toggleOverlay = useCallback((panel: OverlayPanel) => {
    setOverlayVisibility((current) => ({ ...current, [panel]: !current[panel] }));
  }, []);

  const resetLayout = useCallback(() => {
    setOverlayVisibility({ ...DEFAULT_OVERLAY_VISIBILITY });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <>
      <TopBar
        activeCount={activeCount}
        totalTokens={totalTokens}
        agentCount={agents.length}
        overlayVisibility={overlayVisibility}
        onToggleOverlay={toggleOverlay}
        onResetLayout={resetLayout}
      />
      {overlayVisibility.party && <PartyDeck />}

      {overlayVisibility.agents && (
        <aside className="fixed top-[50px] left-4 z-30 hidden w-[290px] md:block">
          <div
            className="glass-panel"
            style={{ borderRadius: 10, padding: 8, maxHeight: "calc(100vh - 190px)" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
                padding: "0 2px",
              }}
            >
              <span
                className="pulse-dot"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#548C5A",
                }}
              />
              <span
                style={{
                  color: "#74747C",
                  fontSize: 10,
                  letterSpacing: 1,
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                Active Agents
              </span>
              <span style={{ marginLeft: "auto", color: "#595653", fontSize: 10 }}>
                {agents.length}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                overflowY: "auto",
                maxHeight: "calc(100vh - 240px)",
                paddingRight: 2,
              }}
            >
              {agents.map((agent) => (
                <AgentCard key={agent.id} agentId={agent.id} />
              ))}
            </div>
          </div>
        </aside>
      )}

      {overlayVisibility.minimap && (
        <div className="fixed right-4 bottom-4 z-30 hidden md:block">
          <div className="glass-panel" style={{ borderRadius: 10, padding: 8 }}>
            <div
              style={{
                color: "#74747C",
                fontSize: 10,
                letterSpacing: 1,
                fontWeight: 600,
                marginBottom: 6,
                textTransform: "uppercase",
              }}
            >
              Office Map
            </div>
            <Minimap />
          </div>
        </div>
      )}

      <div className="fixed right-4 bottom-4 left-4 z-30 md:hidden">
        <div
          className="glass-panel"
          style={{
            borderRadius: 8,
            border: "1px solid rgba(89,86,83,0.28)",
            padding: "7px 10px",
            display: "flex",
            justifyContent: "space-between",
            color: "#74747C",
            fontSize: 11,
          }}
        >
          <span>
            active <strong style={{ color: "#9A9692" }}>{activeCount}</strong>
          </span>
          <span>
            tokens <strong style={{ color: "#9A9692" }}>{formatTokens(totalTokens)}</strong>
          </span>
          <Link href="/docs" style={{ color: "#548C5A", fontWeight: 600 }}>
            docs
          </Link>
          <a
            href={AGENT_SPACE_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#d4a040", fontWeight: 600 }}
          >
            install
          </a>
        </div>
      </div>

      <ToastStack />
    </>
  );
}
