import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type DropZone,
  type Layout,
  type PanelId,
  ALL_PANELS,
  PANEL_MIN_HEIGHT,
  DEFAULT_LAYOUT,
  getDropZone,
  deepCloneLayout,
  removePanelFromLayout,
  insertPanelAtDropZone,
  clampDropZone,
  findAllPanelsInLayout,
} from './layout-engine'
import { useAgentStore } from '../../store/agents'
import { useSettingsStore } from '../../store/settings'
import { useWorkspaceStore } from '../../store/workspace'
import {
  useHotkeys,
  type HotkeyBinding,
  SHORTCUTS,
  PANEL_SHORTCUT_ORDER,
} from '../../hooks/useHotkeys'

const WORKSPACE_LAYOUT_STATE_KEY = 'agent-observer:workspaceLayoutState'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPanelId(value: unknown): value is PanelId {
  return typeof value === 'string' && ALL_PANELS.includes(value as PanelId)
}

function normalizePanelSlot(value: unknown): PanelId | PanelId[] | null {
  if (isPanelId(value)) return value
  if (!Array.isArray(value)) return null

  const normalized = Array.from(new Set(value.filter(isPanelId)))
  if (normalized.length === 0) return null
  return normalized.length === 1 ? normalized[0] : normalized
}

function normalizeLayout(value: unknown): Layout | null {
  if (!Array.isArray(value)) return null

  const columns: Layout = []
  for (const col of value) {
    if (!isObject(col) || !Array.isArray(col.rows)) continue

    const rows = []
    for (const row of col.rows) {
      if (!isObject(row) || !Array.isArray(row.slots)) continue
      const slots = row.slots
        .map(normalizePanelSlot)
        .filter((slot): slot is PanelId | PanelId[] => slot !== null)

      if (slots.length === 0) continue

      let slotWidths = Array.isArray(row.slotWidths)
        ? row.slotWidths
          .map((w) => (typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 0))
          .slice(0, slots.length)
        : []

      if (slotWidths.length !== slots.length || slotWidths.some((w) => w <= 0)) {
        slotWidths = Array.from({ length: slots.length }, () => 1 / slots.length)
      } else {
        const total = slotWidths.reduce((sum, width) => sum + width, 0)
        slotWidths = total > 0
          ? slotWidths.map((width) => width / total)
          : Array.from({ length: slots.length }, () => 1 / slots.length)
      }

      const rawHeight = typeof row.height === 'number' && Number.isFinite(row.height) ? row.height : -1
      const height = rawHeight === -1 ? -1 : Math.max(PANEL_MIN_HEIGHT, rawHeight)
      rows.push({ slots, slotWidths, height })
    }

    if (rows.length === 0) continue
    const width = typeof col.width === 'number' && Number.isFinite(col.width) && col.width > 0 ? col.width : 1
    columns.push({ width, rows })
  }

  if (columns.length === 0) return null
  const totalWidth = columns.reduce((sum, col) => sum + col.width, 0)
  if (totalWidth <= 0) return null

  return columns.map((col) => ({ ...col, width: col.width / totalWidth }))
}

function normalizeActiveTabs(value: unknown): Record<string, PanelId> {
  if (!isObject(value)) return {}
  const activeTabs: Record<string, PanelId> = {}
  for (const [slotKey, panelId] of Object.entries(value)) {
    if (isPanelId(panelId)) {
      activeTabs[slotKey] = panelId
    }
  }
  return activeTabs
}

function ensurePanelVisible(layout: Layout, panelId: PanelId): Layout {
  if (findAllPanelsInLayout(layout).has(panelId)) return layout

  const next = deepCloneLayout(layout)
  if (next.length === 0) {
    return [{ width: 1, rows: [{ slots: [panelId], slotWidths: [1], height: -1 }] }]
  }

  if (panelId === 'fileSearch') {
    for (const col of next) {
      for (const row of col.rows) {
        for (let slotIndex = 0; slotIndex < row.slots.length; slotIndex += 1) {
          const slot = row.slots[slotIndex]
          if (Array.isArray(slot)) {
            if (slot.includes('fileExplorer')) {
              if (!slot.includes('fileSearch')) slot.push('fileSearch')
              return next
            }
          } else if (slot === 'fileExplorer') {
            row.slots[slotIndex] = ['fileExplorer', 'fileSearch']
            return next
          }
        }
      }
    }
  }

  const firstColumn = next[0]
  if (!firstColumn || firstColumn.rows.length === 0) {
    if (firstColumn) {
      firstColumn.rows.push({ slots: [panelId], slotWidths: [1], height: -1 })
      return next
    }
    return [{ width: 1, rows: [{ slots: [panelId], slotWidths: [1], height: -1 }] }]
  }

  const firstRow = firstColumn.rows[0]
  const firstSlot = firstRow.slots[0]
  if (firstSlot === undefined) {
    firstRow.slots = [panelId]
    firstRow.slotWidths = [1]
    return next
  }

  if (Array.isArray(firstSlot)) {
    if (!firstSlot.includes(panelId)) firstSlot.push(panelId)
  } else if (firstSlot !== panelId) {
    firstRow.slots[0] = [firstSlot, panelId]
  }

  return next
}

function loadPersistedWorkspaceLayoutState(): {
  layout: Layout
  activeTabs: Record<string, PanelId>
} {
  try {
    const raw = localStorage.getItem(WORKSPACE_LAYOUT_STATE_KEY)
    if (!raw) return { layout: DEFAULT_LAYOUT, activeTabs: {} }
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)) return { layout: DEFAULT_LAYOUT, activeTabs: {} }

    let layout = normalizeLayout(parsed.layout) ?? DEFAULT_LAYOUT
    layout = ensurePanelVisible(layout, 'fileSearch')

    const activeTabs = normalizeActiveTabs(parsed.activeTabs)
    for (const panelId of new Set(Object.values(activeTabs))) {
      layout = ensurePanelVisible(layout, panelId)
    }

    return { layout, activeTabs }
  } catch {
    return { layout: DEFAULT_LAYOUT, activeTabs: {} }
  }
}

function savePersistedWorkspaceLayoutState(
  layout: Layout,
  activeTabs: Record<string, PanelId>
): void {
  try {
    localStorage.setItem(
      WORKSPACE_LAYOUT_STATE_KEY,
      JSON.stringify({ layout, activeTabs })
    )
  } catch (err) {
    console.error('[WorkspaceLayout] Failed to persist layout state:', err)
  }
}

const hydratedWorkspaceLayoutState = loadPersistedWorkspaceLayoutState()

export interface WorkspaceLayoutController {
  layout: Layout
  dropZone: DropZone | null
  containerRef: React.RefObject<HTMLDivElement | null>
  visiblePanels: Set<PanelId>
  getActiveTab: (panels: PanelId[], key: string) => PanelId
  setActiveTab: (key: string, panelId: PanelId) => void
  handleColumnResize: (dividerIndex: number, deltaX: number) => void
  handleRowResize: (columnIndex: number, dividerIndex: number, deltaY: number) => void
  handleSlotResize: (columnIndex: number, rowIndex: number, dividerIndex: number, deltaX: number) => void
  handleDragStart: (event: React.DragEvent, panelId: PanelId) => void
  handleDragOver: (event: React.DragEvent, columnIndex: number, rowIndex: number, slotIndex: number) => void
  handleDrop: (event: React.DragEvent) => void
  handleHidePanel: (panelId: PanelId) => void
  handleHideSlot: (panels: PanelId[]) => void
  handleTogglePanel: (panelId: PanelId) => void
  openFolderFromDialog: () => void
  focusFileSearch: () => void
  focusFileExplorer: () => void
  triggerNewTerminal: () => void
  closeActivePanel: () => void
  focusChatInput: () => void
  resetLayout: () => void
}

export function useWorkspaceLayoutController(): WorkspaceLayoutController {
  const [layout, setLayout] = useState<Layout>(() => hydratedWorkspaceLayoutState.layout)
  const [draggedPanel, setDraggedPanel] = useState<PanelId | null>(null)
  const [dropZone, setDropZone] = useState<DropZone | null>(null)
  const [activeTabs, setActiveTabs] = useState<Record<string, PanelId>>(
    () => hydratedWorkspaceLayoutState.activeTabs
  )
  const containerRef = useRef<HTMLDivElement>(null)

  const visiblePanels = findAllPanelsInLayout(layout)

  const getActiveTab = useCallback(
    (panels: PanelId[], key: string): PanelId => {
      const stored = activeTabs[key]
      return stored && panels.includes(stored) ? stored : panels[0]
    },
    [activeTabs]
  )

  const setActiveTab = useCallback((key: string, panelId: PanelId) => {
    setActiveTabs((prev) => ({ ...prev, [key]: panelId }))
  }, [])

  const handleColumnResize = useCallback((dividerIndex: number, deltaX: number) => {
    setLayout((prev) => {
      const next = deepCloneLayout(prev)
      const containerWidth = containerRef.current?.clientWidth ?? 1000
      const deltaRatio = deltaX / containerWidth
      const left = next[dividerIndex].width + deltaRatio
      const right = next[dividerIndex + 1].width - deltaRatio
      if (left < 0.15 || right < 0.15) return prev
      next[dividerIndex].width = left
      next[dividerIndex + 1].width = right
      return next
    })
  }, [])

  const handleRowResize = useCallback((columnIndex: number, dividerIndex: number, deltaY: number) => {
    const columnElement = containerRef.current?.querySelector<HTMLElement>(`[data-col="${columnIndex}"]`)
    const columnHeight = columnElement?.clientHeight ?? 0

    setLayout((prev) => {
      const next = deepCloneLayout(prev)
      const column = next[columnIndex]
      let topHeight = column.rows[dividerIndex].height
      let bottomHeight = column.rows[dividerIndex + 1].height

      if (topHeight === -1 || bottomHeight === -1) {
        if (!columnHeight) return prev
        const dividerCount = column.rows.length - 1
        const dividerHeight = 5
        const fixedTotal = column.rows.reduce((sum, row) => sum + (row.height === -1 ? 0 : row.height), 0)
        const flexHeight = Math.max(PANEL_MIN_HEIGHT, columnHeight - fixedTotal - dividerCount * dividerHeight)

        const flexCount = column.rows.filter((row) => row.height === -1).length
        if (flexCount === 0) return prev
        const perFlex = Math.max(PANEL_MIN_HEIGHT, flexHeight / flexCount)

        for (const row of column.rows) {
          if (row.height === -1) row.height = perFlex
        }
        topHeight = column.rows[dividerIndex].height
        bottomHeight = column.rows[dividerIndex + 1].height
      }

      const newTop = topHeight + deltaY
      const newBottom = bottomHeight - deltaY
      if (newTop < PANEL_MIN_HEIGHT || newBottom < PANEL_MIN_HEIGHT) return prev
      column.rows[dividerIndex].height = newTop
      column.rows[dividerIndex + 1].height = newBottom
      return next
    })
  }, [])

  const handleSlotResize = useCallback((columnIndex: number, rowIndex: number, dividerIndex: number, deltaX: number) => {
    setLayout((prev) => {
      const next = deepCloneLayout(prev)
      const row = next[columnIndex].rows[rowIndex]
      const containerWidth = containerRef.current?.clientWidth ?? 1000
      const columnWidth = containerWidth * next[columnIndex].width
      const deltaRatio = deltaX / columnWidth
      const left = row.slotWidths[dividerIndex] + deltaRatio
      const right = row.slotWidths[dividerIndex + 1] - deltaRatio
      if (left < 0.15 || right < 0.15) return prev
      row.slotWidths[dividerIndex] = left
      row.slotWidths[dividerIndex + 1] = right
      return next
    })
  }, [])

  const handleDragStart = useCallback((event: React.DragEvent, panelId: PanelId) => {
    setDraggedPanel(panelId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', panelId)
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.style.opacity = '0.4'
  }, [])

  const handleDragOver = useCallback(
    (event: React.DragEvent, columnIndex: number, rowIndex: number, slotIndex: number) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropZone(getDropZone(event, columnIndex, rowIndex, slotIndex))
    },
    []
  )

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    if (!draggedPanel || !dropZone) return
    const cleaned = removePanelFromLayout(layout, draggedPanel)
    if (cleaned.length === 0) {
      setLayout(DEFAULT_LAYOUT)
      setDraggedPanel(null)
      setDropZone(null)
      return
    }
    const clamped = clampDropZone(cleaned, dropZone)
    const newLayout = insertPanelAtDropZone(cleaned, draggedPanel, clamped)
    setLayout(newLayout)
    setDraggedPanel(null)
    setDropZone(null)
  }, [draggedPanel, dropZone, layout])

  const handleHidePanel = useCallback((panelId: PanelId) => {
    setLayout((prev) => {
      const next = removePanelFromLayout(prev, panelId)
      return next.length > 0 ? next : prev
    })
  }, [])

  const handleHideSlot = useCallback((panels: PanelId[]) => {
    setLayout((prev) => {
      let next = deepCloneLayout(prev)
      for (const panelId of panels) {
        const result = removePanelFromLayout(next, panelId)
        if (result.length > 0) next = result
        else break
      }
      return next
    })
  }, [])

  const handleTogglePanel = useCallback((panelId: PanelId) => {
    if (visiblePanels.has(panelId)) {
      handleHidePanel(panelId)
      return
    }

    setLayout((prev) => {
      const result = deepCloneLayout(prev)
      if (result.length === 0) {
        return [{ width: 1, rows: [{ slots: [panelId], slotWidths: [1], height: -1 }] }]
      }
      const firstRow = result[0].rows[0]
      if (!firstRow) {
        result[0].rows.push({ slots: [panelId], slotWidths: [1], height: -1 })
      } else {
        const slot = firstRow.slots[0]
        if (Array.isArray(slot)) {
          slot.push(panelId)
        } else if (slot !== undefined) {
          firstRow.slots[0] = [slot, panelId]
        }
      }
      setActiveTabs((tabs) => ({ ...tabs, ['0-0-0']: panelId }))
      return result
    })
  }, [visiblePanels, handleHidePanel])

  const focusPanel = useCallback((panelId: PanelId) => {
    if (!findAllPanelsInLayout(layout).has(panelId)) {
      handleTogglePanel(panelId)
      return
    }

    for (let columnIndex = 0; columnIndex < layout.length; columnIndex += 1) {
      for (let rowIndex = 0; rowIndex < layout[columnIndex].rows.length; rowIndex += 1) {
        const row = layout[columnIndex].rows[rowIndex]
        for (let slotIndex = 0; slotIndex < row.slots.length; slotIndex += 1) {
          const slot = row.slots[slotIndex]
          const panels = Array.isArray(slot) ? slot : [slot]
          if (panels.includes(panelId)) {
            setActiveTabs((prev) => ({ ...prev, [`${columnIndex}-${rowIndex}-${slotIndex}`]: panelId }))
            return
          }
        }
      }
    }
  }, [layout, handleTogglePanel])

  const openSettings = useSettingsStore((s) => s.openSettings)
  const openHelp = useSettingsStore((s) => s.openHelp)
  const openFolder = useWorkspaceStore((s) => s.openFolder)

  useEffect(() => {
    savePersistedWorkspaceLayoutState(layout, activeTabs)
  }, [layout, activeTabs])

  const triggerNewTerminal = useCallback(() => {
    window.dispatchEvent(new CustomEvent('hotkey:newTerminal'))
  }, [])

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_LAYOUT)
    setActiveTabs({})
  }, [])

  const closeActivePanel = useCallback(() => {
    for (const panelId of Object.values(activeTabs)) {
      if (findAllPanelsInLayout(layout).has(panelId)) {
        handleHidePanel(panelId)
        return
      }
    }
  }, [activeTabs, layout, handleHidePanel])

  const focusChatInput = useCallback(() => {
    focusPanel('chat')
    setTimeout(() => {
      const input = document.querySelector<HTMLTextAreaElement>('[data-chat-input]')
      if (input) input.focus()
    }, 50)
  }, [focusPanel])

  const openFolderFromDialog = useCallback(() => {
    void (async () => {
      try {
        const selected = await window.electronAPI.fs.openFolderDialog()
        if (selected) useWorkspaceStore.getState().openFolder(selected)
      } catch (err) {
        console.error('[WorkspaceLayout] Open folder failed:', err)
      }
    })()
  }, [])

  const focusFileSearch = useCallback(() => {
    focusPanel('fileSearch')
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('[data-file-search-input]')
      if (input) input.focus()
    }, 50)
  }, [focusPanel])

  const focusFileExplorer = useCallback(() => {
    focusPanel('fileExplorer')
  }, [focusPanel])

  const hotkeyBindings: HotkeyBinding[] = [
    ...PANEL_SHORTCUT_ORDER.map((panelId, index) => {
      const shortcutKey = `focus${panelId.charAt(0).toUpperCase() + panelId.slice(1)}` as keyof typeof SHORTCUTS
      const def = SHORTCUTS[shortcutKey] ?? {
        hotkey: { key: String(index + 1), metaOrCtrl: true },
        label: `⌘${index + 1}`,
      }
      return {
        hotkey: def.hotkey,
        label: def.label,
        description: def.description,
        handler: () => focusPanel(panelId as PanelId),
      }
    }),
    {
      ...SHORTCUTS.openSettings,
      handler: () => openSettings(),
    },
    {
      ...SHORTCUTS.openHelp,
      handler: () => openHelp(),
    },
    {
      ...SHORTCUTS.newTerminal,
      handler: triggerNewTerminal,
    },
    {
      ...SHORTCUTS.resetLayout,
      handler: resetLayout,
    },
    {
      ...SHORTCUTS.closePanel,
      handler: closeActivePanel,
    },
    {
      ...SHORTCUTS.focusChatInput,
      handler: focusChatInput,
    },
    {
      ...SHORTCUTS.openFolder,
      handler: openFolderFromDialog,
    },
    {
      ...SHORTCUTS.fileSearch,
      handler: focusFileSearch,
    },
    {
      ...SHORTCUTS.fileExplorer,
      handler: focusFileExplorer,
    },
    {
      ...SHORTCUTS.escape,
      handler: () => {
        const settingsStore = useSettingsStore.getState()
        if (settingsStore.isOpen) {
          settingsStore.closeSettings()
          return
        }
        if (settingsStore.isHelpOpen) {
          settingsStore.closeHelp()
          return
        }
        const agentStore = useAgentStore.getState()
        if (agentStore.selectedAgentId) {
          agentStore.selectAgent(null)
        }
      },
    },
  ]

  useHotkeys(hotkeyBindings)

  useEffect(() => {
    const api = window.electronAPI?.fs
    if (!api?.onOpenFolder) return
    return api.onOpenFolder((folderPath: string) => {
      openFolder(folderPath)
    })
  }, [openFolder])

  useEffect(() => {
    const api = window.electronAPI?.settings
    if (!api) return

    const unsubs: Array<() => void> = []

    if (api.onNewTerminal) {
      unsubs.push(api.onNewTerminal(() => {
        triggerNewTerminal()
      }))
    }

    if (api.onFocusChat) {
      unsubs.push(api.onFocusChat(() => {
        focusChatInput()
      }))
    }

    if (api.onResetLayout) {
      unsubs.push(api.onResetLayout(() => {
        resetLayout()
      }))
    }

    if (api.onFocusPanel) {
      unsubs.push(api.onFocusPanel((panelId: string) => {
        focusPanel(panelId as PanelId)
      }))
    }

    return () => {
      unsubs.forEach((fn) => fn())
    }
  }, [focusPanel, focusChatInput, resetLayout, triggerNewTerminal])

  return {
    layout,
    dropZone,
    containerRef,
    visiblePanels,
    getActiveTab,
    setActiveTab,
    handleColumnResize,
    handleRowResize,
    handleSlotResize,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleHidePanel,
    handleHideSlot,
    handleTogglePanel,
    openFolderFromDialog,
    focusFileSearch,
    focusFileExplorer,
    triggerNewTerminal,
    closeActivePanel,
    focusChatInput,
    resetLayout,
  }
}
