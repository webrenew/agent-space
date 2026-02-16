import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type CSSProperties,
  type LazyExoticComponent,
  type RefObject,
} from 'react'
import { RowDivider } from './RowDivider'
import { ColDivider } from './ColDivider'
import {
  type DropZone,
  type Layout,
  type PanelId,
  PANEL_LABELS,
  PANEL_MIN_HEIGHT,
} from './layout-engine'
import { ChatPanelWrapper } from './panels/ChatPanelWrapper'
import { TerminalPanelWrapper } from './panels/TerminalPanelWrapper'

function dispatchFileOpen(filePath: string): void {
  window.dispatchEvent(new CustomEvent('file:open', { detail: filePath }))
}

const LazyScenePanel = lazy(async () => {
  const mod = await import('./panels/ScenePanel')
  return { default: mod.ScenePanel }
})

const LazyActivityPanel = lazy(async () => {
  const mod = await import('./panels/ActivityPanel')
  return { default: mod.ActivityPanel }
})

const LazyAgentsPanel = lazy(async () => {
  const mod = await import('./panels/AgentsPanel')
  return { default: mod.AgentsPanel }
})

const LazyRecentMemoriesPanel = lazy(async () => {
  const mod = await import('./panels/RecentMemoriesPanel')
  return { default: mod.RecentMemoriesPanel }
})

const LazyTokensPanel = lazy(async () => {
  const mod = await import('./panels/TokensPanel')
  return { default: mod.TokensPanel }
})

const LazyFileExplorerPanel = lazy(async () => {
  const mod = await import('./panels/FileExplorerPanel')
  return { default: mod.FileExplorerPanel }
})

const LazyFileSearchPanel = lazy(async () => {
  const mod = await import('./panels/FileSearchPanel')
  return { default: mod.FileSearchPanel }
})

const LazyFileEditorPanel = lazy(async () => {
  const mod = await import('./panels/FileEditorPanel')
  return { default: mod.FileEditorPanel }
})

function FileExplorerWrapper() {
  return <LazyFileExplorerPanel onOpenFile={dispatchFileOpen} />
}

function FileSearchWrapper() {
  return <LazyFileSearchPanel onOpenFile={dispatchFileOpen} />
}

type PanelComponent = ComponentType | LazyExoticComponent<ComponentType>

const PANEL_COMPONENTS: Record<PanelId, PanelComponent> = {
  chat: ChatPanelWrapper,
  terminal: TerminalPanelWrapper,
  tokens: LazyTokensPanel,
  scene3d: LazyScenePanel,
  activity: LazyActivityPanel,
  agents: LazyAgentsPanel,
  recentMemories: LazyRecentMemoriesPanel,
  fileExplorer: FileExplorerWrapper,
  fileSearch: FileSearchWrapper,
  filePreview: LazyFileEditorPanel,
}

function PanelLoading({ panelId }: { panelId: PanelId }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#595653',
        fontSize: 12,
        letterSpacing: 0.5,
      }}
    >
      Loading {PANEL_LABELS[panelId]}...
    </div>
  )
}

function SlotPanelContent({
  panels,
  activePanel,
}: {
  panels: PanelId[]
  activePanel: PanelId
}) {
  const [mountedPanels, setMountedPanels] = useState<PanelId[]>(() => [activePanel])
  const panelsKey = panels.join('|')

  useEffect(() => {
    setMountedPanels((prev) => {
      const allowed = new Set(panels)
      const filtered = prev.filter((panelId) => allowed.has(panelId))
      return filtered.includes(activePanel) ? filtered : [...filtered, activePanel]
    })
  }, [activePanel, panelsKey])

  return (
    <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
      {mountedPanels.map((panelId) => {
        const Comp = PANEL_COMPONENTS[panelId]
        return (
          <div
            key={panelId}
            style={{
              display: panelId === activePanel ? 'flex' : 'none',
              flexDirection: 'column',
              height: '100%',
              overflow: 'hidden',
            }}
          >
            <Suspense fallback={<PanelLoading panelId={panelId} />}>
              <Comp />
            </Suspense>
          </div>
        )
      })}
    </div>
  )
}

function SlotTabBar({
  panels,
  activeTab,
  onSelect,
  onHide,
  onHideSlot,
  onDragStart,
}: {
  panels: PanelId[]
  activeTab: PanelId
  onSelect: (panelId: PanelId) => void
  onHide: (panelId: PanelId) => void
  onHideSlot: () => void
  onDragStart: (event: React.DragEvent, panelId: PanelId) => void
}) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid rgba(89,86,83,0.2)', flexShrink: 0, minHeight: 30 }}>
      {panels.map((panelId) => (
        <div
          key={panelId}
          draggable
          onDragStart={(event) => onDragStart(event, panelId)}
          onClick={() => onSelect(panelId)}
          className="slot-tab"
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600, letterSpacing: 1, cursor: 'pointer',
            color: panelId === activeTab ? '#548C5A' : '#595653',
            borderBottom: panelId === activeTab ? '2px solid #548C5A' : '2px solid transparent',
            textShadow: panelId === activeTab ? '0 0 8px rgba(84,140,90,0.4)' : 'none',
            display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none',
          }}
        >
          {PANEL_LABELS[panelId]}
          <span
            className="tab-close"
            onClick={(event) => {
              event.stopPropagation()
              onHide(panelId)
            }}
          >
            ×
          </span>
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <button
        onClick={onHideSlot}
        className="slot-hide-btn"
        title="Hide section"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <circle cx="5" cy="5" r="4" />
        </svg>
      </button>
    </div>
  )
}

function DropOverlay({
  zone,
  columnIndex,
  rowIndex,
  slotIndex,
}: {
  zone: DropZone | null
  columnIndex: number
  rowIndex: number
  slotIndex: number
}) {
  if (!zone || zone.columnIndex !== columnIndex || zone.rowIndex !== rowIndex || zone.slotIndex !== slotIndex) {
    return null
  }
  if (zone.position === 'center') return <div className="drop-indicator-center" />

  const base: CSSProperties = { position: 'absolute', zIndex: 20, pointerEvents: 'none' }
  if (zone.position === 'top') return <div className="drop-indicator-h" style={{ ...base, top: 0, left: 0, right: 0 }} />
  if (zone.position === 'bottom') return <div className="drop-indicator-h" style={{ ...base, bottom: 0, left: 0, right: 0 }} />
  if (zone.position === 'left') return <div className="drop-indicator-v" style={{ ...base, top: 0, bottom: 0, left: 0 }} />
  if (zone.position === 'right') return <div className="drop-indicator-v" style={{ ...base, top: 0, bottom: 0, right: 0 }} />
  return null
}

interface WorkspaceGridRendererProps {
  layout: Layout
  containerRef: RefObject<HTMLDivElement | null>
  dropZone: DropZone | null
  getActiveTab: (panels: PanelId[], key: string) => PanelId
  onSetActiveTab: (key: string, panelId: PanelId) => void
  onHidePanel: (panelId: PanelId) => void
  onHideSlot: (panels: PanelId[]) => void
  onDragStart: (event: React.DragEvent, panelId: PanelId) => void
  onDragOver: (event: React.DragEvent, columnIndex: number, rowIndex: number, slotIndex: number) => void
  onDrop: (event: React.DragEvent) => void
  onColumnResize: (dividerIndex: number, deltaX: number) => void
  onRowResize: (columnIndex: number, dividerIndex: number, deltaY: number) => void
  onSlotResize: (columnIndex: number, rowIndex: number, dividerIndex: number, deltaX: number) => void
}

export function WorkspaceGridRenderer({
  layout,
  containerRef,
  dropZone,
  getActiveTab,
  onSetActiveTab,
  onHidePanel,
  onHideSlot,
  onDragStart,
  onDragOver,
  onDrop,
  onColumnResize,
  onRowResize,
  onSlotResize,
}: WorkspaceGridRendererProps) {
  return (
    <div ref={containerRef} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {layout.map((column, columnIndex) => (
        <Fragment key={columnIndex}>
          <div
            data-col={columnIndex}
            style={{
              flex: `0 0 ${column.width * 100}%`,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {column.rows.map((row, rowIndex) => {
              const isFlex = row.height === -1

              return (
                <Fragment key={rowIndex}>
                  <div
                    style={{
                      display: 'flex',
                      ...(isFlex
                        ? { flex: '1 1 0', minHeight: PANEL_MIN_HEIGHT }
                        : { height: row.height, flexShrink: 0 }),
                    }}
                  >
                    {row.slots.map((slot, slotIndex) => {
                      const panels = Array.isArray(slot) ? slot : [slot]
                      const slotKey = `${columnIndex}-${rowIndex}-${slotIndex}`
                      const activePanel = getActiveTab(panels, slotKey)

                      return (
                        <Fragment key={slotKey}>
                          <div
                            onDragOver={(event) => onDragOver(event, columnIndex, rowIndex, slotIndex)}
                            onDrop={onDrop}
                            style={{
                              flex: `0 0 ${(row.slotWidths[slotIndex] ?? 1 / row.slots.length) * 100}%`,
                              display: 'flex',
                              flexDirection: 'column',
                              overflow: 'hidden',
                              position: 'relative',
                              height: '100%',
                            }}
                          >
                            <SlotTabBar
                              panels={panels}
                              activeTab={activePanel}
                              onSelect={(panelId) => onSetActiveTab(slotKey, panelId)}
                              onHide={onHidePanel}
                              onHideSlot={() => onHideSlot(panels)}
                              onDragStart={onDragStart}
                            />
                            <SlotPanelContent key={slotKey} panels={panels} activePanel={activePanel} />
                            <DropOverlay
                              zone={dropZone}
                              columnIndex={columnIndex}
                              rowIndex={rowIndex}
                              slotIndex={slotIndex}
                            />
                          </div>
                          {slotIndex < row.slots.length - 1 && (
                            <ColDivider onDrag={(deltaX) => onSlotResize(columnIndex, rowIndex, slotIndex, deltaX)} />
                          )}
                        </Fragment>
                      )
                    })}
                  </div>
                  {rowIndex < column.rows.length - 1 && (
                    <RowDivider onDrag={(deltaY) => onRowResize(columnIndex, rowIndex, deltaY)} />
                  )}
                </Fragment>
              )
            })}
          </div>
          {columnIndex < layout.length - 1 && (
            <ColDivider onDrag={(deltaX) => onColumnResize(columnIndex, deltaX)} />
          )}
        </Fragment>
      ))}
    </div>
  )
}
