// ── Panel Types ───────────────────────────────────────────────────

export type PanelId =
  | 'chat'
  | 'terminal'
  | 'tokens'
  | 'scene3d'
  | 'activity'
  | 'agents'
  | 'recentMemories'
  | 'fileExplorer'
  | 'fileSearch'
  | 'filePreview'

/** A slot is either a single panel or a tabbed stack of panels */
export type PanelSlot = PanelId | PanelId[]

export interface LayoutRow {
  slots: PanelSlot[]
  slotWidths: number[] // normalized (sum ≈ 1)
  height: number       // px, or -1 for flex-fill
}

export interface LayoutColumn {
  rows: LayoutRow[]
  width: number // 0–1 normalized
}

export type Layout = LayoutColumn[]

// ── Constants ─────────────────────────────────────────────────────

export const ALL_PANELS: PanelId[] = [
  'chat', 'terminal', 'tokens',
  'scene3d', 'activity', 'agents', 'recentMemories',
  'fileExplorer', 'fileSearch', 'filePreview',
]

export const PANEL_LABELS: Record<PanelId, string> = {
  chat: 'CHAT',
  terminal: 'TERMINAL',
  tokens: 'TOKENS',
  scene3d: 'OFFICE',
  activity: 'ACTIVITY',
  agents: 'AGENTS',
  recentMemories: 'RECENT',
  fileExplorer: 'EXPLORER',
  fileSearch: 'SEARCH',
  filePreview: 'EDITOR',
}

export const PANEL_MIN_HEIGHT = 60

export const DEFAULT_LAYOUT: Layout = [
  {
    width: 0.18,
    rows: [
      { slots: [['fileExplorer', 'fileSearch']], slotWidths: [1], height: -1 },
    ],
  },
  {
    width: 0.47,
    rows: [
      { slots: [['chat', 'terminal', 'tokens']], slotWidths: [1], height: -1 },
    ],
  },
  {
    width: 0.35,
    rows: [
      { slots: ['scene3d'], slotWidths: [1], height: 260 },
      { slots: [['activity', 'filePreview']], slotWidths: [1], height: -1 },
    ],
  },
]

// ── Drop Zone ─────────────────────────────────────────────────────

export interface DropZone {
  columnIndex: number
  rowIndex: number
  slotIndex: number
  position: 'top' | 'bottom' | 'left' | 'right' | 'center'
}

export function getDropZone(
  e: React.DragEvent,
  columnIndex: number,
  rowIndex: number,
  slotIndex: number,
): DropZone {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const relX = (e.clientX - rect.left) / rect.width
  const relY = (e.clientY - rect.top) / rect.height

  // Center = stack onto existing slot
  if (relX > 0.25 && relX < 0.75 && relY > 0.25 && relY < 0.75) {
    return { columnIndex, rowIndex, slotIndex, position: 'center' }
  }
  if (relX < 0.2) return { columnIndex, rowIndex, slotIndex, position: 'left' }
  if (relX > 0.8) return { columnIndex, rowIndex, slotIndex, position: 'right' }
  if (relY < 0.5) return { columnIndex, rowIndex, slotIndex, position: 'top' }
  return { columnIndex, rowIndex, slotIndex, position: 'bottom' }
}

// ── Helpers ───────────────────────────────────────────────────────

export function deepCloneLayout(layout: Layout): Layout {
  return layout.map((col) => ({
    ...col,
    rows: col.rows.map((row) => ({
      ...row,
      slots: row.slots.map((slot) => (Array.isArray(slot) ? [...slot] : slot)),
      slotWidths: [...row.slotWidths],
    })),
  }))
}

export function findAllPanelsInLayout(layout: Layout): Set<PanelId> {
  const result = new Set<PanelId>()
  for (const col of layout) {
    for (const row of col.rows) {
      for (const slot of row.slots) {
        if (Array.isArray(slot)) {
          for (const p of slot) result.add(p)
        } else {
          result.add(slot)
        }
      }
    }
  }
  return result
}

// ── Layout Mutations ──────────────────────────────────────────────

export function removePanelFromLayout(layout: Layout, panelId: PanelId): Layout {
  const cleaned = deepCloneLayout(layout)

  for (const col of cleaned) {
    for (let ri = col.rows.length - 1; ri >= 0; ri--) {
      const row = col.rows[ri]
      for (let si = row.slots.length - 1; si >= 0; si--) {
        const slot = row.slots[si]
        if (Array.isArray(slot)) {
          const idx = slot.indexOf(panelId)
          if (idx >= 0) {
            slot.splice(idx, 1)
            if (slot.length === 1) {
              row.slots[si] = slot[0] // stack → single
            } else if (slot.length === 0) {
              row.slots.splice(si, 1)
              row.slotWidths.splice(si, 1)
            }
          }
        } else if (slot === panelId) {
          row.slots.splice(si, 1)
          row.slotWidths.splice(si, 1)
        }
      }
      // Renormalize widths
      if (row.slots.length > 0) {
        const total = row.slotWidths.reduce((a, b) => a + b, 0)
        if (total > 0) row.slotWidths = row.slotWidths.map((w) => w / total)
      }
    }
    col.rows = col.rows.filter((r) => r.slots.length > 0)

    // Ensure at least one row is flex so the column fills its height
    if (col.rows.length > 0 && !col.rows.some((r) => r.height === -1)) {
      col.rows[col.rows.length - 1].height = -1
    }
  }

  // Remove empty columns, redistribute widths
  const nonEmpty = cleaned.filter((c) => c.rows.length > 0)
  if (nonEmpty.length > 0 && nonEmpty.length < cleaned.length) {
    const totalW = nonEmpty.reduce((a, c) => a + c.width, 0)
    for (const c of nonEmpty) c.width = c.width / totalW
  }
  return nonEmpty
}

export function insertPanelAtDropZone(
  layout: Layout,
  panelId: PanelId,
  zone: DropZone,
): Layout {
  const result = deepCloneLayout(layout)
  const col = result[zone.columnIndex]
  if (!col) return result

  switch (zone.position) {
    case 'center': {
      const row = col.rows[zone.rowIndex]
      if (!row) return result
      const slot = row.slots[zone.slotIndex]
      if (Array.isArray(slot)) {
        slot.push(panelId)
      } else if (slot !== undefined) {
        row.slots[zone.slotIndex] = [slot, panelId]
      }
      return result
    }
    case 'left':
    case 'right': {
      const row = col.rows[zone.rowIndex]
      if (!row) return result
      const at = zone.position === 'left' ? zone.slotIndex : zone.slotIndex + 1
      row.slots.splice(at, 0, panelId)
      row.slotWidths = row.slots.map(() => 1 / row.slots.length)
      return result
    }
    case 'top':
    case 'bottom': {
      const at = zone.position === 'top' ? zone.rowIndex : zone.rowIndex + 1
      col.rows.splice(at, 0, { slots: [panelId], slotWidths: [1], height: 180 })
      return result
    }
  }
  return result
}

export function clampDropZone(layout: Layout, zone: DropZone): DropZone {
  const ci = Math.max(0, Math.min(zone.columnIndex, layout.length - 1))
  const col = layout[ci]
  if (!col || col.rows.length === 0) return { ...zone, columnIndex: ci, rowIndex: 0, slotIndex: 0 }
  const ri = Math.max(0, Math.min(zone.rowIndex, col.rows.length - 1))
  const row = col.rows[ri]
  const si = Math.max(0, Math.min(zone.slotIndex, row.slots.length - 1))
  return { ...zone, columnIndex: ci, rowIndex: ri, slotIndex: si }
}
