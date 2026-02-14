import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useWorkspaceStore } from '../../../store/workspace'

// ── Types ────────────────────────────────────────────────────────────

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modified: number
}

interface TreeNode extends FileEntry {
  children?: TreeNode[]
  isExpanded: boolean
  isLoading: boolean
  depth: number
}

// ── Context menu types ────────────────────────────────────────────────

interface ContextMenuState {
  x: number
  y: number
  node: TreeNode
}

interface RenameState {
  path: string
  currentName: string
}

// ── File icon helper ─────────────────────────────────────────────────

function fileIcon(name: string, isDir: boolean, isExpanded: boolean): string {
  if (isDir) return isExpanded ? '▾' : '▸'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts': case 'tsx': return '◇'
    case 'js': case 'jsx': return '◆'
    case 'json': return '{ }'[0] ?? '{'
    case 'md': case 'mdx': return '¶'
    case 'css': case 'scss': case 'less': return '#'
    case 'html': return '<'
    case 'svg': case 'png': case 'jpg': case 'gif': case 'webp': return '◻'
    case 'sh': case 'bash': case 'zsh': return '$'
    case 'yaml': case 'yml': case 'toml': return '≡'
    case 'lock': return '⊘'
    default: return '·'
  }
}

function iconColor(name: string, isDir: boolean): string {
  if (isDir) return '#d4a040'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts': case 'tsx': return '#548C5A'
    case 'js': case 'jsx': return '#d4a040'
    case 'json': return '#c87830'
    case 'md': case 'mdx': return '#74747C'
    case 'css': case 'scss': return '#6b8fa3'
    case 'html': return '#c45050'
    default: return '#595653'
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}M`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}K`
  return `${bytes}B`
}

// ── Props ────────────────────────────────────────────────────────────

interface Props {
  onOpenFile?: (filePath: string) => void
}

// ── Component ────────────────────────────────────────────────────────

export function FileExplorerPanel({ onOpenFile }: Props) {
  const workspaceRoot = useWorkspaceStore((s) => s.rootPath)
  const openFolder = useWorkspaceStore((s) => s.openFolder)
  const recentFolders = useWorkspaceStore((s) => s.recentFolders)

  // browsePath is the currently displayed directory — starts at workspace root
  const [browsePath, setBrowsePath] = useState<string>('')
  const [tree, setTree] = useState<TreeNode[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renaming, setRenaming] = useState<RenameState | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

  // Focus rename input when it appears
  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [renaming])

  // Sync browsePath with workspace root
  useEffect(() => {
    if (workspaceRoot) setBrowsePath(workspaceRoot)
  }, [workspaceRoot])

  // Handle "Open Folder" via native dialog
  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await window.electronAPI.fs.openFolderDialog()
      if (selected) openFolder(selected)
    } catch (err) {
      console.error('[FileExplorer] Open folder dialog failed:', err)
    }
  }, [openFolder])

  // Load displayed directory
  useEffect(() => {
    if (!browsePath) return
    async function load(): Promise<void> {
      setIsLoading(true)
      setError(null)
      try {
        const entries = await window.electronAPI.fs.readDir(browsePath)
        setTree(entries.map((e) => ({
          ...e,
          isExpanded: false,
          isLoading: false,
          depth: 0,
        })))
      } catch (err) {
        console.error('[FileExplorer] Failed to read directory:', err)
        setError(`Failed to read: ${browsePath}`)
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [browsePath])

  const toggleExpand = useCallback(async (node: TreeNode) => {
    if (!node.isDirectory) {
      setSelectedPath(node.path)
      onOpenFile?.(node.path)
      return
    }

    // If already loaded, just toggle
    if (node.children !== undefined) {
      setTree((prev) => updateNodeInTree(prev, node.path, { isExpanded: !node.isExpanded }))
      return
    }

    // Load children
    setTree((prev) => updateNodeInTree(prev, node.path, { isLoading: true, isExpanded: true }))
    try {
      const entries = await window.electronAPI.fs.readDir(node.path)
      const children: TreeNode[] = entries.map((e) => ({
        ...e,
        isExpanded: false,
        isLoading: false,
        depth: node.depth + 1,
      }))
      setTree((prev) => updateNodeInTree(prev, node.path, { children, isLoading: false }))
    } catch (err) {
      console.error('[FileExplorer] Failed to expand:', err)
      setTree((prev) => updateNodeInTree(prev, node.path, { isLoading: false, isExpanded: false }))
    }
  }, [onOpenFile])

  const handleNavigateUp = useCallback(() => {
    if (!browsePath) return
    const parent = browsePath.split('/').slice(0, -1).join('/') || '/'
    setBrowsePath(parent)
  }, [browsePath])

  const handleNavigateTo = useCallback((dirPath: string) => {
    setBrowsePath(dirPath)
  }, [])

  // ── Context menu actions ──────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, node })
    setSelectedPath(node.path)
  }, [])

  const handleCopyPath = useCallback(() => {
    if (!contextMenu) return
    navigator.clipboard.writeText(contextMenu.node.path)
    setContextMenu(null)
  }, [contextMenu])

  const handleCopyRelativePath = useCallback(() => {
    if (!contextMenu || !browsePath) return
    const rootForRelative = workspaceRoot ?? browsePath
    const relative = contextMenu.node.path.startsWith(rootForRelative)
      ? contextMenu.node.path.slice(rootForRelative.length + 1)
      : contextMenu.node.path
    navigator.clipboard.writeText(relative)
    setContextMenu(null)
  }, [contextMenu, browsePath, workspaceRoot])

  const handleCopyName = useCallback(() => {
    if (!contextMenu) return
    navigator.clipboard.writeText(contextMenu.node.name)
    setContextMenu(null)
  }, [contextMenu])

  const handleRevealInFinder = useCallback(() => {
    if (!contextMenu) return
    window.electronAPI.fs.revealInFinder(contextMenu.node.path)
    setContextMenu(null)
  }, [contextMenu])

  const handleOpenInTerminal = useCallback(() => {
    if (!contextMenu) return
    const dir = contextMenu.node.isDirectory
      ? contextMenu.node.path
      : contextMenu.node.path.split('/').slice(0, -1).join('/')
    window.electronAPI.fs.openInTerminal(dir)
    setContextMenu(null)
  }, [contextMenu])

  const handleStartRename = useCallback(() => {
    if (!contextMenu) return
    setRenaming({ path: contextMenu.node.path, currentName: contextMenu.node.name })
    setRenameValue(contextMenu.node.name)
    setContextMenu(null)
  }, [contextMenu])

  const handleRenameSubmit = useCallback(async () => {
    if (!renaming || !renameValue.trim() || renameValue === renaming.currentName) {
      setRenaming(null)
      return
    }
    try {
      await window.electronAPI.fs.rename(renaming.path, renameValue.trim())
      // Refresh the tree by reloading current directory
      if (browsePath) {
        const entries = await window.electronAPI.fs.readDir(browsePath)
        setTree(entries.map((e) => ({
          ...e,
          isExpanded: false,
          isLoading: false,
          depth: 0,
        })))
      }
    } catch (err) {
      console.error('[FileExplorer] Rename failed:', err)
    }
    setRenaming(null)
  }, [renaming, renameValue, browsePath])

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return
    const node = contextMenu.node
    setContextMenu(null)

    const typeLabel = node.isDirectory ? 'folder' : 'file'
    // Simple confirmation via window.confirm (no native dialog dependency needed)
    if (!window.confirm(`Delete ${typeLabel} "${node.name}"?`)) return

    try {
      await window.electronAPI.fs.delete(node.path)
      // Refresh
      if (browsePath) {
        const entries = await window.electronAPI.fs.readDir(browsePath)
        setTree(entries.map((e) => ({
          ...e,
          isExpanded: false,
          isLoading: false,
          depth: 0,
        })))
      }
    } catch (err) {
      console.error('[FileExplorer] Delete failed:', err)
    }
  }, [contextMenu, browsePath])

  // Flatten tree for rendering
  const flatNodes = flattenTree(tree)

  // No folder open — show welcome state
  if (!browsePath) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0E0E0D', color: '#9A9692' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 }}>
          <span style={{ fontSize: 28, color: '#3a3a38' }}>⊞</span>
          <span style={{ color: '#595653', fontSize: 12, textAlign: 'center' }}>No folder open</span>
          <button
            onClick={() => void handleOpenFolder()}
            style={{
              background: '#548C5A', color: '#0E0E0D', border: 'none', borderRadius: 4,
              padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Open Folder
          </button>
          {recentFolders.length > 0 && (
            <div style={{ marginTop: 8, width: '100%' }}>
              <div style={{ color: '#595653', fontSize: 10, fontWeight: 600, letterSpacing: 1, marginBottom: 6, paddingLeft: 4 }}>
                RECENT
              </div>
              {recentFolders.slice(0, 5).map((folder) => {
                const name = folder.split('/').pop() ?? folder
                return (
                  <div
                    key={folder}
                    className="hover-row"
                    onClick={() => openFolder(folder)}
                    style={{ padding: '4px 8px', cursor: 'pointer', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 1 }}
                  >
                    <span style={{ color: '#9A9692' }}>{name}</span>
                    <span style={{ color: '#3a3a38', fontSize: 10 }}>{folder}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0E0E0D', color: '#9A9692' }}>
      {/* Breadcrumb bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
        borderBottom: '1px solid rgba(89,86,83,0.2)', flexShrink: 0, fontSize: 11,
      }}>
        <button
          onClick={handleNavigateUp}
          style={{ background: 'transparent', border: 'none', color: '#595653', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, padding: '0 4px' }}
          title="Go up"
        >
          ↑
        </button>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: '#74747C' }}>
          {browsePath.split('/').filter(Boolean).map((seg, i, arr) => {
            const segPath = '/' + arr.slice(0, i + 1).join('/')
            const isLast = i === arr.length - 1
            return (
              <span key={segPath}>
                <span
                  onClick={() => handleNavigateTo(segPath)}
                  style={{ cursor: 'pointer', color: isLast ? '#9A9692' : '#595653' }}
                >
                  {seg}
                </span>
                {!isLast && <span style={{ color: '#3a3a38', margin: '0 3px' }}>/</span>}
              </span>
            )
          })}
        </div>
        <button
          onClick={() => void handleOpenFolder()}
          style={{ background: 'transparent', border: 'none', color: '#595653', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, padding: '0 4px' }}
          title="Open different folder (⌘O)"
        >
          ⊞
        </button>
      </div>

      {/* File tree */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 16, color: '#595653', fontSize: 12 }}>Loading...</div>
        ) : error ? (
          <div style={{ padding: 16, color: '#c45050', fontSize: 12 }}>{error}</div>
        ) : flatNodes.length === 0 ? (
          <div style={{ padding: 16, color: '#595653', fontSize: 12 }}>Empty directory</div>
        ) : (
          flatNodes.map((node) => (
            <div
              key={node.path}
              className="hover-row"
              onClick={() => void toggleExpand(node)}
              onDoubleClick={() => {
                if (node.isDirectory) handleNavigateTo(node.path)
              }}
              onContextMenu={(e) => handleContextMenu(e, node)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: `2px 8px 2px ${8 + node.depth * 16}px`,
                cursor: 'pointer', fontSize: 12, minHeight: 24,
                background: selectedPath === node.path ? 'rgba(84,140,90,0.1)' : 'transparent',
              }}
            >
              <span style={{ color: iconColor(node.name, node.isDirectory), width: 14, textAlign: 'center', flexShrink: 0, fontSize: node.isDirectory ? 10 : 12 }}>
                {node.isLoading ? '⟳' : fileIcon(node.name, node.isDirectory, node.isExpanded)}
              </span>
              {renaming && renaming.path === node.path ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRenameSubmit()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={() => void handleRenameSubmit()}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    flex: 1, background: 'rgba(89,86,83,0.2)', border: '1px solid rgba(84,140,90,0.4)',
                    borderRadius: 2, color: '#9A9692', fontSize: 12, fontFamily: 'inherit',
                    padding: '1px 4px', outline: 'none',
                  }}
                />
              ) : (
                <span style={{
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: node.isDirectory ? '#9A9692' : '#74747C',
                  fontWeight: node.isDirectory ? 500 : 400,
                }}>
                  {node.name}
                </span>
              )}
              {!node.isDirectory && renaming?.path !== node.path && (
                <span style={{ color: '#3a3a38', fontSize: 10, flexShrink: 0 }}>
                  {formatSize(node.size)}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 9999,
            background: '#1a1a19',
            border: '1px solid rgba(89,86,83,0.3)',
            borderRadius: 4,
            padding: '4px 0',
            minWidth: 180,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            fontSize: 12,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <ContextMenuItem label="Copy Path" shortcut="⌥⌘C" onClick={handleCopyPath} />
          <ContextMenuItem label="Copy Relative Path" shortcut="⇧⌥⌘C" onClick={handleCopyRelativePath} />
          <ContextMenuItem label="Copy Name" onClick={handleCopyName} />
          <div style={{ height: 1, background: 'rgba(89,86,83,0.2)', margin: '4px 0' }} />
          <ContextMenuItem label="Rename" shortcut="Enter" onClick={handleStartRename} />
          <ContextMenuItem label="Delete" danger onClick={() => void handleDelete()} />
          <div style={{ height: 1, background: 'rgba(89,86,83,0.2)', margin: '4px 0' }} />
          <ContextMenuItem label="Reveal in Finder" onClick={handleRevealInFinder} />
          <ContextMenuItem label="Open in Terminal" onClick={handleOpenInTerminal} />
        </div>
      )}
    </div>
  )
}

// ── Context menu item ─────────────────────────────────────────────────

function ContextMenuItem({
  label,
  shortcut,
  danger,
  onClick,
}: {
  label: string
  shortcut?: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <div
      className="hover-row"
      onClick={onClick}
      style={{
        padding: '5px 12px',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        color: danger ? '#c45050' : '#9A9692',
      }}
    >
      <span>{label}</span>
      {shortcut && (
        <span style={{ color: '#595653', fontSize: 10, marginLeft: 20 }}>{shortcut}</span>
      )}
    </div>
  )
}

// ── Tree helpers ──────────────────────────────────────────────────────

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.isDirectory && node.isExpanded && node.children) {
      result.push(...flattenTree(node.children))
    }
  }
  return result
}

function updateNodeInTree(nodes: TreeNode[], targetPath: string, updates: Partial<TreeNode>): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, ...updates }
    }
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, targetPath, updates) }
    }
    return node
  })
}
