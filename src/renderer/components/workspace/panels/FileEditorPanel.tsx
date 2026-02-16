/**
 * FileEditorPanel — Monaco-based editor + multi-type preview panel.
 *
 * Listens for:
 * - `file:open` custom events (Explorer/Search panels)
 * - `file:propose-update` custom events (agent/user proposal flow)
 *
 * Text-like files support staged writes with diff preview.
 */

import '../../../monaco-setup'
import { useState, useEffect, useRef, useCallback, type CSSProperties, type ReactElement } from 'react'
import Editor, { DiffEditor, type OnMount, type Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useLspBridge } from '../../../hooks/useLspBridge'
import { useSettingsStore } from '../../../store/settings'
import {
  stageImageProposal,
  stagePdfProposal,
  unavailableNonTextDiffMessage,
  type NonTextPreviewKind,
  type StagedImageProposal,
  type StagedPdfProposal,
} from '../../../lib/non-text-diff'

// ── Language detection ────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html',
  md: 'markdown', mdx: 'markdown',
  svg: 'xml', xml: 'xml',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  dockerfile: 'dockerfile', makefile: 'makefile',
  env: 'plaintext', gitignore: 'plaintext', lock: 'plaintext',
}

function detectLang(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile') return 'makefile'
  const ext = lower.split('.').pop() ?? ''
  return EXT_TO_LANG[ext] ?? 'plaintext'
}

function langColor(lang: string): string {
  switch (lang) {
    case 'typescript': case 'typescriptreact': return '#548C5A'
    case 'javascript': case 'javascriptreact': return '#d4a040'
    case 'json': return '#c87830'
    case 'css': case 'scss': case 'less': return '#6b8fa3'
    case 'html': case 'xml': return '#c45050'
    case 'python': return '#548C5A'
    case 'rust': return '#c87830'
    default: return '#595653'
  }
}

// ── Preview-kind detection ────────────────────────────────────────────

type PreviewKind = 'text' | 'markdown' | 'image' | 'audio' | 'video' | 'pdf' | 'binary'
type ViewMode = 'edit' | 'preview' | 'diff'
type ProposalSource = 'agent' | 'user'

interface FileUpdateProposal {
  path: string
  content: string
  source?: ProposalSource
}

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg', 'avif',
])

const MARKDOWN_EXTS = new Set(['md', 'mdx'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi'])
const PDF_EXTS = new Set(['pdf'])

const BINARY_EXTS = new Set([
  'zip', 'gz', 'tar', 'rar', '7z',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'doc', 'docx', 'xls', 'xlsx',
  'exe', 'dll', 'so', 'dylib', 'node',
])

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function detectPreviewKind(name: string): PreviewKind {
  const ext = extension(name)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (MARKDOWN_EXTS.has(ext)) return 'markdown'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (PDF_EXTS.has(ext)) return 'pdf'
  if (BINARY_EXTS.has(ext)) return 'binary'
  return 'text'
}

function isTextPreviewKind(kind: PreviewKind): boolean {
  return kind === 'text' || kind === 'markdown'
}

function defaultViewMode(kind: PreviewKind): ViewMode {
  if (kind === 'markdown') return 'preview'
  if (kind === 'text') return 'edit'
  return 'preview'
}

function previewColor(kind: PreviewKind, lang: string): string {
  if (kind === 'text' || kind === 'markdown') return langColor(lang)
  if (kind === 'pdf') return '#c45050'
  if (kind === 'binary') return '#74747C'
  return '#6b8fa3'
}

function previewLabel(kind: PreviewKind, lang: string): string {
  if (kind === 'text') return lang
  return kind
}

function nonTextDiffFallbackNotice(kind: PreviewKind, fileName: string): string {
  if (kind === 'text' || kind === 'markdown') {
    return 'Diff preview is unavailable for this file type. Compare externally and apply manually.'
  }
  return unavailableNonTextDiffMessage(kind as NonTextPreviewKind, fileName)
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

function renderMarkdown(content: string): ReactElement[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const elements: ReactElement[] = []
  let key = 0

  let paragraph: string[] = []
  let listItems: string[] = []
  let codeLines: string[] = []
  let codeLang = ''
  let inCode = false

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    elements.push(
      <p key={`p-${key++}`} style={{ margin: '0 0 10px 0', lineHeight: 1.55 }}>
        {paragraph.join(' ')}
      </p>
    )
    paragraph = []
  }

  const flushList = () => {
    if (listItems.length === 0) return
    elements.push(
      <ul key={`ul-${key++}`} style={{ margin: '0 0 10px 0', paddingLeft: 20 }}>
        {listItems.map((item, itemIndex) => <li key={`li-${itemIndex}`}>{item}</li>)}
      </ul>
    )
    listItems = []
  }

  const flushCode = () => {
    elements.push(
      <div key={`code-${key++}`} style={{ margin: '0 0 10px 0' }}>
        {codeLang && (
          <div style={{ fontSize: 10, color: '#595653', marginBottom: 4 }}>{codeLang}</div>
        )}
        <pre
          style={{
            margin: 0,
            padding: 10,
            background: '#141413',
            border: '1px solid rgba(89,86,83,0.24)',
            borderRadius: 6,
            overflowX: 'auto',
            whiteSpace: 'pre',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {codeLines.join('\n')}
        </pre>
      </div>
    )
    codeLines = []
    codeLang = ''
  }

  for (const rawLine of lines) {
    const line = rawLine
    const trimmed = line.trim()

    if (inCode) {
      if (trimmed.startsWith('```')) {
        inCode = false
        flushCode()
      } else {
        codeLines.push(line)
      }
      continue
    }

    if (trimmed.startsWith('```')) {
      flushParagraph()
      flushList()
      inCode = true
      codeLang = trimmed.slice(3).trim()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      const text = heading[2].trim()
      const fontSize = Math.max(12, 22 - level * 2)
      elements.push(
        <div
          key={`h-${key++}`}
          style={{ margin: '0 0 10px 0', fontSize, fontWeight: 600, lineHeight: 1.35, color: '#e2dfda' }}
        >
          {text}
        </div>
      )
      continue
    }

    const list = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (list) {
      flushParagraph()
      listItems.push(list[1].trim())
      continue
    }

    if (/^\s*>/.test(line)) {
      flushParagraph()
      flushList()
      elements.push(
        <blockquote
          key={`q-${key++}`}
          style={{
            margin: '0 0 10px 0',
            borderLeft: '3px solid #3a3a38',
            padding: '6px 10px',
            color: '#b7b4af',
            background: '#141413',
            borderRadius: 4,
          }}
        >
          {line.replace(/^\s*>\s?/, '')}
        </blockquote>
      )
      continue
    }

    if (trimmed.length === 0) {
      flushParagraph()
      flushList()
      continue
    }

    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()
  if (inCode) flushCode()

  if (elements.length === 0) {
    elements.push(
      <p key="empty-md" style={{ margin: 0, color: '#595653' }}>
        Empty file
      </p>
    )
  }

  return elements
}

// ── Custom orchid-dark Monaco theme ──────────────────────────────────

function defineOrchidTheme(monaco: Monaco): void {
  monaco.editor.defineTheme('orchid-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: '9A9692', background: '0E0E0D' },
      { token: 'comment', foreground: '595653', fontStyle: 'italic' },
      { token: 'keyword', foreground: '548C5A' },
      { token: 'string', foreground: 'd4a040' },
      { token: 'number', foreground: 'c87830' },
      { token: 'type', foreground: '6b8fa3' },
      { token: 'function', foreground: '9A9692' },
      { token: 'variable', foreground: '9A9692' },
      { token: 'constant', foreground: 'c87830' },
      { token: 'operator', foreground: '74747C' },
      { token: 'delimiter', foreground: '595653' },
      { token: 'tag', foreground: 'c45050' },
      { token: 'attribute.name', foreground: '548C5A' },
      { token: 'attribute.value', foreground: 'd4a040' },
    ],
    colors: {
      'editor.background': '#0E0E0D',
      'editor.foreground': '#9A9692',
      'editor.lineHighlightBackground': '#1A1A19',
      'editor.selectionBackground': '#548C5A30',
      'editor.inactiveSelectionBackground': '#548C5A15',
      'editorCursor.foreground': '#548C5A',
      'editorLineNumber.foreground': '#3a3a38',
      'editorLineNumber.activeForeground': '#595653',
      'editorIndentGuide.background': '#1A1A19',
      'editorIndentGuide.activeBackground': '#2a2a28',
      'editor.selectionHighlightBackground': '#548C5A15',
      'editorBracketMatch.background': '#548C5A20',
      'editorBracketMatch.border': '#548C5A40',
      'editorWidget.background': '#141413',
      'editorWidget.foreground': '#9A9692',
      'editorWidget.border': '#2a2a28',
      'editorSuggestWidget.background': '#141413',
      'editorSuggestWidget.border': '#2a2a28',
      'editorSuggestWidget.foreground': '#9A9692',
      'editorSuggestWidget.selectedBackground': '#548C5A20',
      'editorSuggestWidget.highlightForeground': '#548C5A',
      'editorHoverWidget.background': '#141413',
      'editorHoverWidget.border': '#2a2a28',
      'input.background': '#1A1A19',
      'input.foreground': '#9A9692',
      'input.border': '#2a2a28',
      'minimap.background': '#0E0E0D',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': '#59565330',
      'scrollbarSlider.hoverBackground': '#59565350',
      'scrollbarSlider.activeBackground': '#59565370',
    },
  })
}

function applyEditorAppearance(target: editor.IStandaloneCodeEditor): void {
  const { appearance } = useSettingsStore.getState().settings
  target.updateOptions({
    minimap: { enabled: false },
    fontSize: appearance.fontSize,
    lineHeight: Math.round(appearance.fontSize * 1.54),
    fontFamily: appearance.fontFamily,
    fontLigatures: true,
    padding: { top: 8, bottom: 8 },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    suggest: { showStatusBar: true },
    wordWrap: 'off',
    tabSize: 2,
  })
}

function modeButtonStyle(active: boolean): CSSProperties {
  return {
    border: '1px solid rgba(89,86,83,0.28)',
    background: active ? '#1f1f1d' : '#121211',
    color: active ? '#d4d1cb' : '#7f7a75',
    fontSize: 10,
    lineHeight: 1,
    padding: '5px 8px',
    borderRadius: 5,
    cursor: 'pointer',
  }
}

// ── Component ────────────────────────────────────────────────────────

export function FileEditorPanel() {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [savedContent, setSavedContent] = useState<string>('')
  const [imagePreviewDataUrl, setImagePreviewDataUrl] = useState<string | null>(null)
  const [mediaPreviewDataUrl, setMediaPreviewDataUrl] = useState<string | null>(null)
  const [stagedImageProposal, setStagedImageProposal] = useState<StagedImageProposal | null>(null)
  const [stagedPdfProposal, setStagedPdfProposal] = useState<StagedPdfProposal | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposalNotice, setProposalNotice] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState(0)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('edit')
  const [proposalSource, setProposalSource] = useState<ProposalSource | null>(null)
  const [diagnosticCounts, setDiagnosticCounts] = useState({ errors: 0, warnings: 0 })

  const monacoRef = useRef<Monaco | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const diffContentListenerRef = useRef<{ dispose: () => void } | null>(null)
  const savedContentRef = useRef<string>('')
  const pendingProposalRef = useRef<FileUpdateProposal | null>(null)

  const fileName = filePath?.split('/').pop() ?? ''
  const lang = filePath ? detectLang(fileName) : 'plaintext'
  const previewKind = filePath ? detectPreviewKind(fileName) : 'text'
  const isTextFile = isTextPreviewKind(previewKind)
  const hasStagedImageProposal = previewKind === 'image' && stagedImageProposal !== null
  const hasStagedPdfProposal = previewKind === 'pdf' && stagedPdfProposal !== null
  const hasPendingChanges = isTextFile ? isDirty : (hasStagedImageProposal || hasStagedPdfProposal)
  const fileTypeLabel = previewLabel(previewKind, lang)
  const fileTypeColor = previewColor(previewKind, lang)
  const canPreviewText = isTextFile

  const lspPath = isTextFile ? filePath : null
  const lspLang = isTextFile ? lang : 'plaintext'
  const { notifyChange } = useLspBridge(lspPath, lspLang, monacoRef, editorRef)

  const applyProposalToCurrentFile = useCallback((proposal: FileUpdateProposal) => {
    setContent(proposal.content)
    setIsDirty(proposal.content !== savedContentRef.current)
    setViewMode('diff')
    setProposalSource(proposal.source ?? 'agent')
    setProposalNotice(null)
    notifyChange(proposal.content)
  }, [notifyChange])

  const applyImageProposalToCurrentFile = useCallback((proposal: FileUpdateProposal) => {
    const staged = stageImageProposal('', proposal.content)
    if (!staged.next.stagedProposal) {
      setStagedImageProposal(null)
      setStagedPdfProposal(null)
      setProposalSource(proposal.source ?? 'agent')
      setProposalNotice(staged.notice)
      setViewMode('preview')
      return
    }

    setStagedImageProposal(staged.next.stagedProposal)
    setStagedPdfProposal(null)
    setProposalSource(proposal.source ?? 'agent')
    setProposalNotice(null)
    setViewMode('diff')
  }, [])

  const applyPdfProposalToCurrentFile = useCallback((proposal: FileUpdateProposal, currentDataUrlOverride?: string) => {
    const staged = stagePdfProposal(currentDataUrlOverride ?? mediaPreviewDataUrl ?? '', proposal.content)
    if (!staged.next.stagedProposal) {
      setStagedPdfProposal(null)
      setStagedImageProposal(null)
      setProposalSource(proposal.source ?? 'agent')
      setProposalNotice(staged.notice)
      setViewMode('preview')
      return
    }

    setStagedPdfProposal(staged.next.stagedProposal)
    setStagedImageProposal(null)
    setProposalSource(proposal.source ?? 'agent')
    setProposalNotice(null)
    setViewMode('diff')
  }, [mediaPreviewDataUrl])

  // Listen for file open/proposal events
  useEffect(() => {
    const openHandler = (e: Event): void => {
      const detail = (e as CustomEvent<string | { path: string }>).detail
      const nextPath = typeof detail === 'string' ? detail : detail?.path
      if (!nextPath) return
      pendingProposalRef.current = null
      setProposalSource(null)
      setProposalNotice(null)
      setStagedImageProposal(null)
      setStagedPdfProposal(null)
      setFilePath(nextPath)
    }

    const proposalHandler = (e: Event): void => {
      const detail = (e as CustomEvent<FileUpdateProposal>).detail
      if (!detail?.path || typeof detail.content !== 'string') return

      if (detail.path === filePath) {
        pendingProposalRef.current = detail
        if (!isLoading && isTextFile) {
          pendingProposalRef.current = null
          applyProposalToCurrentFile(detail)
        } else if (!isLoading && previewKind === 'image') {
          pendingProposalRef.current = null
          applyImageProposalToCurrentFile(detail)
        } else if (!isLoading && previewKind === 'pdf') {
          pendingProposalRef.current = null
          applyPdfProposalToCurrentFile(detail)
        } else if (!isLoading) {
          pendingProposalRef.current = null
          setProposalSource(detail.source ?? 'agent')
          setProposalNotice(nonTextDiffFallbackNotice(previewKind, fileName))
        }
        return
      }

      pendingProposalRef.current = detail
      setFilePath(detail.path)
    }

    window.addEventListener('file:open', openHandler)
    window.addEventListener('file:propose-update', proposalHandler as EventListener)
    return () => {
      window.removeEventListener('file:open', openHandler)
      window.removeEventListener('file:propose-update', proposalHandler as EventListener)
    }
  }, [applyImageProposalToCurrentFile, applyPdfProposalToCurrentFile, applyProposalToCurrentFile, fileName, filePath, isLoading, isTextFile, previewKind])

  // Load file content/preview
  useEffect(() => {
    if (!filePath) return
    const targetPath = filePath

    setDiagnosticCounts({ errors: 0, warnings: 0 })
    setError(null)
    setIsDirty(false)
    setIsSaving(false)
    setIsTruncated(false)
    setImagePreviewDataUrl(null)
    setMediaPreviewDataUrl(null)
    setStagedImageProposal(null)
    setStagedPdfProposal(null)
    setProposalNotice(null)
    setViewMode(defaultViewMode(previewKind))

    let cancelled = false

    if (previewKind === 'image') {
      setIsLoading(true)
      setContent('')
      setSavedContent('')
      savedContentRef.current = ''
      setProposalSource(null)

      async function loadImagePreview(): Promise<void> {
        try {
          const result = await window.electronAPI.fs.readImageDataUrl(targetPath)
          if (cancelled) return
          setImagePreviewDataUrl(result.dataUrl)
          setFileSize(result.size)

          const pending = pendingProposalRef.current
          if (pending && pending.path === targetPath) {
            pendingProposalRef.current = null
            applyImageProposalToCurrentFile(pending)
          }
        } catch (err) {
          if (cancelled) return
          console.error('[FileEditor] Image preview load failed:', err)
          setError(`Failed to preview image: ${err instanceof Error ? err.message : 'unknown'}`)
        } finally {
          if (!cancelled) setIsLoading(false)
        }
      }

      void loadImagePreview()
      return () => { cancelled = true }
    }

    if (previewKind === 'audio' || previewKind === 'video' || previewKind === 'pdf') {
      setIsLoading(true)
      setContent('')
      setSavedContent('')
      savedContentRef.current = ''
      setProposalSource(null)

      async function loadMediaPreview(): Promise<void> {
        try {
          const result = await window.electronAPI.fs.readDataUrl(targetPath)
          if (cancelled) return
          setMediaPreviewDataUrl(result.dataUrl)
          setFileSize(result.size)

          const pending = pendingProposalRef.current
          if (pending && pending.path === targetPath) {
            pendingProposalRef.current = null
            if (previewKind === 'pdf') {
              applyPdfProposalToCurrentFile(pending, result.dataUrl)
            } else {
              setProposalSource(pending.source ?? 'agent')
              setProposalNotice(nonTextDiffFallbackNotice(previewKind, fileName))
            }
          }
        } catch (err) {
          if (cancelled) return
          console.error('[FileEditor] Media preview load failed:', err)
          setError(`Failed to preview media: ${err instanceof Error ? err.message : 'unknown'}`)
        } finally {
          if (!cancelled) setIsLoading(false)
        }
      }

      void loadMediaPreview()
      return () => { cancelled = true }
    }

    if (previewKind === 'binary') {
      setIsLoading(true)
      setContent('')
      setSavedContent('')
      savedContentRef.current = ''
      setProposalSource(null)

      async function loadBinaryMetadata(): Promise<void> {
        try {
          const stat = await window.electronAPI.fs.stat(targetPath)
          if (cancelled) return
          setFileSize(stat.size)

          const pending = pendingProposalRef.current
          if (pending && pending.path === targetPath) {
            pendingProposalRef.current = null
            setProposalSource(pending.source ?? 'agent')
            setProposalNotice(nonTextDiffFallbackNotice(previewKind, fileName))
          }
        } catch (err) {
          if (cancelled) return
          console.error('[FileEditor] Binary metadata load failed:', err)
          setError(`Failed to inspect file: ${err instanceof Error ? err.message : 'unknown'}`)
        } finally {
          if (!cancelled) setIsLoading(false)
        }
      }

      void loadBinaryMetadata()
      return () => { cancelled = true }
    }

    setIsLoading(true)
    setProposalSource(null)

    async function loadTextFile(): Promise<void> {
      try {
        const result = await window.electronAPI.fs.readFile(targetPath)
        if (cancelled) return

        savedContentRef.current = result.content
        setSavedContent(result.content)
        setFileSize(result.size)
        setIsTruncated(result.truncated)

        const pending = pendingProposalRef.current
        if (pending && pending.path === targetPath) {
          pendingProposalRef.current = null
          setContent(pending.content)
          setIsDirty(pending.content !== result.content)
          setProposalSource(pending.source ?? 'agent')
          setViewMode('diff')
          notifyChange(pending.content)
        } else {
          setContent(result.content)
          setIsDirty(false)
          setViewMode(defaultViewMode(previewKind))
        }
      } catch (err) {
        if (cancelled) return
        console.error('[FileEditor] Load failed:', err)
        setError(`Failed to load: ${err instanceof Error ? err.message : 'unknown'}`)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadTextFile()
    return () => { cancelled = true }
  }, [applyImageProposalToCurrentFile, applyPdfProposalToCurrentFile, fileName, filePath, notifyChange, previewKind])

  // Save handler (staged through diff preview)
  const handleSave = useCallback(async () => {
    if (!filePath || !isTextFile || isSaving) return
    const nextValue = editorRef.current?.getValue() ?? content
    if (nextValue === savedContentRef.current) {
      setIsDirty(false)
      return
    }

    if (viewMode !== 'diff') {
      setViewMode('diff')
      return
    }

    setIsSaving(true)
    try {
      await window.electronAPI.fs.writeFile(filePath, nextValue)
      savedContentRef.current = nextValue
      setSavedContent(nextValue)
      setContent(nextValue)
      setIsDirty(false)
      setProposalSource(null)
      setViewMode(previewKind === 'markdown' ? 'preview' : 'edit')
    } catch (err) {
      console.error('[FileEditor] Save failed:', err)
      setError(`Failed to save: ${err instanceof Error ? err.message : 'unknown'}`)
    } finally {
      setIsSaving(false)
    }
  }, [content, filePath, isSaving, isTextFile, previewKind, viewMode])

  const handleApplyImageProposal = useCallback(async () => {
    if (!filePath || previewKind !== 'image' || !stagedImageProposal || isSaving) return

    setIsSaving(true)
    try {
      const result = await window.electronAPI.fs.writeDataUrl(filePath, stagedImageProposal.dataUrl)
      setImagePreviewDataUrl(stagedImageProposal.dataUrl)
      setFileSize(result.size)
      setStagedImageProposal(null)
      setProposalSource(null)
      setProposalNotice(null)
      setViewMode('preview')
    } catch (err) {
      console.error('[FileEditor] Image apply failed:', err)
      setError(`Failed to apply image update: ${err instanceof Error ? err.message : 'unknown'}`)
    } finally {
      setIsSaving(false)
    }
  }, [filePath, isSaving, previewKind, stagedImageProposal])

  const handleApplyPdfProposal = useCallback(async () => {
    if (!filePath || previewKind !== 'pdf' || !stagedPdfProposal || isSaving) return

    setIsSaving(true)
    try {
      const result = await window.electronAPI.fs.writeDataUrl(filePath, stagedPdfProposal.dataUrl)
      setMediaPreviewDataUrl(stagedPdfProposal.dataUrl)
      setFileSize(result.size)
      setStagedPdfProposal(null)
      setProposalSource(null)
      setProposalNotice(null)
      setViewMode('preview')
    } catch (err) {
      console.error('[FileEditor] PDF apply failed:', err)
      setError(`Failed to apply PDF update: ${err instanceof Error ? err.message : 'unknown'}`)
    } finally {
      setIsSaving(false)
    }
  }, [filePath, isSaving, previewKind, stagedPdfProposal])

  const handleDiscardChanges = useCallback(() => {
    if (isTextFile) {
      setContent(savedContentRef.current)
      setIsDirty(false)
      setProposalSource(null)
      setProposalNotice(null)
      setViewMode(previewKind === 'markdown' ? 'preview' : 'edit')
      return
    }

    if (previewKind === 'image') {
      setStagedImageProposal(null)
      setProposalSource(null)
      setProposalNotice(null)
      setViewMode('preview')
      return
    }

    if (previewKind === 'pdf') {
      setStagedPdfProposal(null)
      setProposalSource(null)
      setProposalNotice(null)
      setViewMode('preview')
    }
  }, [isTextFile, previewKind])

  // Listen for Cmd/Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!isTextFile) return
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (editorRef.current?.hasTextFocus()) {
          e.preventDefault()
          e.stopPropagation()
          void handleSave()
        }
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [handleSave, isTextFile])

  // Track diagnostic counts from markers
  useEffect(() => {
    if (!monacoRef.current) return

    const disposable = monacoRef.current.editor.onDidChangeMarkers(() => {
      const model = editorRef.current?.getModel()
      if (!model || !monacoRef.current) return
      const markers = monacoRef.current.editor.getModelMarkers({ resource: model.uri })
      let errors = 0
      let warnings = 0
      for (const m of markers) {
        if (m.severity === monacoRef.current.MarkerSeverity.Error) errors++
        else if (m.severity === monacoRef.current.MarkerSeverity.Warning) warnings++
      }
      setDiagnosticCounts({ errors, warnings })
    })

    return () => disposable.dispose()
  }, [])

  const handleEditorMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance
    monacoRef.current = monaco
    diffEditorRef.current = null
    diffContentListenerRef.current?.dispose()
    diffContentListenerRef.current = null

    defineOrchidTheme(monaco)
    monaco.editor.setTheme('orchid-dark')

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      strict: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    })

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
    })

    applyEditorAppearance(editorInstance)
  }

  const handleDiffEditorMount = (diffEditor: editor.IStandaloneDiffEditor, monaco: Monaco): void => {
    monacoRef.current = monaco
    diffEditorRef.current = diffEditor
    const modifiedEditor = diffEditor.getModifiedEditor()
    editorRef.current = modifiedEditor

    defineOrchidTheme(monaco)
    monaco.editor.setTheme('orchid-dark')

    applyEditorAppearance(modifiedEditor)
    applyEditorAppearance(diffEditor.getOriginalEditor())

    diffContentListenerRef.current?.dispose()
    diffContentListenerRef.current = modifiedEditor.onDidChangeModelContent(() => {
      const value = modifiedEditor.getValue()
      setContent(value)
      setIsDirty(value !== savedContentRef.current)
      notifyChange(value)
    })
  }

  const handleReadonlyDiffEditorMount = useCallback((diffEditor: editor.IStandaloneDiffEditor, monaco: Monaco): void => {
    defineOrchidTheme(monaco)
    monaco.editor.setTheme('orchid-dark')

    const originalEditor = diffEditor.getOriginalEditor()
    const modifiedEditor = diffEditor.getModifiedEditor()
    applyEditorAppearance(originalEditor)
    applyEditorAppearance(modifiedEditor)
    originalEditor.updateOptions({ readOnly: true })
    modifiedEditor.updateOptions({ readOnly: true })
  }, [])

  useEffect(() => {
    return () => {
      diffContentListenerRef.current?.dispose()
      diffContentListenerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (viewMode === 'diff') return
    diffContentListenerRef.current?.dispose()
    diffContentListenerRef.current = null
  }, [viewMode])

  // Live-update Monaco when appearance settings change
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state) => {
      const { fontFamily: ff, fontSize: fs } = state.settings.appearance
      const modified = editorRef.current
      if (modified) {
        modified.updateOptions({
          fontSize: fs,
          lineHeight: Math.round(fs * 1.54),
          fontFamily: ff,
        })
      }
      const diff = diffEditorRef.current
      if (diff) {
        diff.getOriginalEditor().updateOptions({
          fontSize: fs,
          lineHeight: Math.round(fs * 1.54),
          fontFamily: ff,
        })
      }
    })
    return unsub
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value === undefined) return
    setContent(value)
    setIsDirty(value !== savedContentRef.current)
    notifyChange(value)
  }, [notifyChange])

  let body: ReactElement
  if (!filePath) {
    body = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 24, color: '#3a3a38' }}>◻</span>
        <span style={{ color: '#595653', fontSize: 12 }}>Open a file to preview or edit</span>
        <span style={{ color: '#3a3a38', fontSize: 10 }}>Use Explorer or ⌘P to search</span>
      </div>
    )
  } else if (isLoading) {
    body = <div style={{ padding: 16, color: '#595653', fontSize: 12 }}>Loading...</div>
  } else if (error) {
    body = <div style={{ padding: 16, color: '#c45050', fontSize: 12 }}>{error}</div>
  } else if (previewKind === 'image' && viewMode === 'diff' && imagePreviewDataUrl && stagedImageProposal) {
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100%', gap: 10, padding: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ color: '#595653', fontSize: 10 }}>Current</span>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 10,
              border: '1px solid rgba(89,86,83,0.2)',
              borderRadius: 6,
              backgroundImage: `
                linear-gradient(45deg, rgba(89,86,83,0.18) 25%, transparent 25%),
                linear-gradient(-45deg, rgba(89,86,83,0.18) 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, rgba(89,86,83,0.18) 75%),
                linear-gradient(-45deg, transparent 75%, rgba(89,86,83,0.18) 75%)
              `,
              backgroundSize: '18px 18px',
              backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0px',
            }}
          >
            <img src={imagePreviewDataUrl} alt={`${fileName} current`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          </div>
          <span style={{ color: '#3a3a38', fontSize: 10 }}>{formatSize(fileSize)}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ color: '#6b8fa3', fontSize: 10 }}>Proposed</span>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 10,
              border: '1px solid rgba(107,143,163,0.35)',
              borderRadius: 6,
              backgroundImage: `
                linear-gradient(45deg, rgba(89,86,83,0.18) 25%, transparent 25%),
                linear-gradient(-45deg, rgba(89,86,83,0.18) 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, rgba(89,86,83,0.18) 75%),
                linear-gradient(-45deg, transparent 75%, rgba(89,86,83,0.18) 75%)
              `,
              backgroundSize: '18px 18px',
              backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0px',
            }}
          >
            <img src={stagedImageProposal.dataUrl} alt={`${fileName} proposed`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          </div>
          <span style={{ color: '#3a3a38', fontSize: 10 }}>
            {formatSize(stagedImageProposal.size)} • {stagedImageProposal.mimeType}
          </span>
        </div>
      </div>
    )
  } else if (previewKind === 'image' && imagePreviewDataUrl) {
    body = (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          backgroundImage: `
            linear-gradient(45deg, rgba(89,86,83,0.18) 25%, transparent 25%),
            linear-gradient(-45deg, rgba(89,86,83,0.18) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, rgba(89,86,83,0.18) 75%),
            linear-gradient(-45deg, transparent 75%, rgba(89,86,83,0.18) 75%)
          `,
          backgroundSize: '18px 18px',
          backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0px',
        }}
      >
        <img
          src={imagePreviewDataUrl}
          alt={fileName}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            border: '1px solid rgba(89,86,83,0.25)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
            borderRadius: 6,
          }}
        />
      </div>
    )
  } else if (previewKind === 'video' && mediaPreviewDataUrl) {
    body = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 16 }}>
        <video
          src={mediaPreviewDataUrl}
          controls
          style={{ width: '100%', height: '100%', borderRadius: 8, background: '#000' }}
        />
      </div>
    )
  } else if (previewKind === 'audio' && mediaPreviewDataUrl) {
    body = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 16 }}>
        <audio src={mediaPreviewDataUrl} controls style={{ width: '100%' }} />
      </div>
    )
  } else if (previewKind === 'pdf' && viewMode === 'diff' && stagedPdfProposal) {
    body = (
      <DiffEditor
        height="100%"
        language="plaintext"
        original={stagedPdfProposal.currentText}
        modified={stagedPdfProposal.proposedText}
        theme="orchid-dark"
        onMount={handleReadonlyDiffEditorMount}
        options={{
          readOnly: true,
          automaticLayout: true,
          originalEditable: false,
          renderSideBySide: true,
          enableSplitViewResizing: true,
          ignoreTrimWhitespace: false,
          minimap: { enabled: false },
        }}
      />
    )
  } else if (previewKind === 'pdf' && mediaPreviewDataUrl) {
    body = (
      <iframe
        src={mediaPreviewDataUrl}
        title={fileName}
        style={{ border: 'none', width: '100%', height: '100%', background: '#0E0E0D' }}
      />
    )
  } else if (previewKind === 'binary') {
    body = (
      <div style={{ padding: 16, color: '#9A9692', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ color: '#74747C' }}>Binary file preview</div>
        <div style={{ color: '#595653' }}>Inline rendering is unavailable for this type.</div>
        <div style={{ color: '#3a3a38', fontSize: 11 }}>Open in external tools to inspect or edit this file.</div>
      </div>
    )
  } else if (isTextFile && viewMode === 'preview') {
    body = (
      <div style={{ height: '100%', overflow: 'auto', padding: 14, fontSize: 12, color: '#c9c5bf' }}>
        {previewKind === 'markdown' ? (
          <article style={{ maxWidth: 980 }}>{renderMarkdown(content)}</article>
        ) : (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{content}</pre>
        )}
      </div>
    )
  } else if (isTextFile && viewMode === 'diff') {
    body = (
      <DiffEditor
        height="100%"
        language={lang}
        original={savedContent}
        modified={content}
        theme="orchid-dark"
        onMount={handleDiffEditorMount}
        options={{
          readOnly: false,
          automaticLayout: true,
          originalEditable: false,
          renderSideBySide: true,
          enableSplitViewResizing: true,
          ignoreTrimWhitespace: false,
          minimap: { enabled: false },
        }}
      />
    )
  } else {
    body = (
      <Editor
        height="100%"
        language={lang}
        value={content}
        theme="orchid-dark"
        onMount={handleEditorMount}
        onChange={handleEditorChange}
        options={{
          readOnly: !isTextFile,
          automaticLayout: true,
        }}
      />
    )
  }

  const statusMessage = !filePath
    ? ''
    : hasStagedImageProposal && viewMode === 'diff'
      ? 'Image diff preview (apply writes file)'
    : hasStagedImageProposal
        ? 'Image proposal staged'
      : hasStagedPdfProposal && viewMode === 'diff'
          ? 'PDF text diff preview (apply writes file)'
        : hasStagedPdfProposal
            ? 'PDF proposal staged'
        : !isTextFile
          ? (proposalNotice ?? `${fileTypeLabel} preview`)
          : viewMode === 'diff'
            ? 'Diff preview (⌘/Ctrl+S to apply)'
            : isDirty
              ? '⌘/Ctrl+S opens diff'
              : '⌘/Ctrl+S save'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0E0E0D', color: '#9A9692' }}>
      {/* Header bar */}
      {filePath && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          borderBottom: '1px solid rgba(89,86,83,0.2)',
          flexShrink: 0,
          fontSize: 12,
        }}>
          <span style={{ color: '#9A9692', fontWeight: 500 }}>
            {hasPendingChanges ? '● ' : ''}{fileName}
          </span>
          <span style={{
            color: fileTypeColor,
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 6px',
            background: `${fileTypeColor}15`,
            borderRadius: 3,
          }}>
            {fileTypeLabel}
          </span>
          {isTruncated && (
            <span style={{ color: '#d4a040', fontSize: 10 }}>truncated</span>
          )}
          {proposalSource && (
            <span style={{ color: '#6b8fa3', fontSize: 10 }}>{proposalSource} proposal</span>
          )}
          <div style={{ flex: 1 }} />

          {isTextFile && (
            <>
              <button
                type="button"
                style={modeButtonStyle(viewMode === 'edit')}
                onClick={() => setViewMode('edit')}
                title="Edit mode"
              >
                Edit
              </button>
              {canPreviewText && (
                <button
                  type="button"
                  style={modeButtonStyle(viewMode === 'preview')}
                  onClick={() => setViewMode('preview')}
                  title="Preview mode"
                >
                  Preview
                </button>
              )}
              <button
                type="button"
                style={modeButtonStyle(viewMode === 'diff')}
                onClick={() => setViewMode('diff')}
                title="Diff preview"
              >
                Diff
              </button>
            </>
          )}
          {hasStagedImageProposal && (
            <>
              <button
                type="button"
                style={modeButtonStyle(viewMode === 'preview')}
                onClick={() => setViewMode('preview')}
                title="Preview mode"
              >
                Preview
              </button>
              <button
                type="button"
                style={modeButtonStyle(viewMode === 'diff')}
                onClick={() => setViewMode('diff')}
                title="Diff preview"
              >
                Diff
              </button>
            </>
          )}
          {hasStagedPdfProposal && (
            <>
              <button
                type="button"
                style={modeButtonStyle(viewMode === 'preview')}
                onClick={() => setViewMode('preview')}
                title="Preview mode"
              >
                Preview
              </button>
              <button
                type="button"
                style={modeButtonStyle(viewMode === 'diff')}
                onClick={() => setViewMode('diff')}
                title="Diff preview"
              >
                Diff
              </button>
            </>
          )}

          {diagnosticCounts.errors > 0 && (
            <span style={{ color: '#c45050', fontSize: 10 }}>
              ✕ {diagnosticCounts.errors}
            </span>
          )}
          {diagnosticCounts.warnings > 0 && (
            <span style={{ color: '#d4a040', fontSize: 10 }}>
              ⚠ {diagnosticCounts.warnings}
            </span>
          )}
          {fileSize > 0 && (
            <span style={{ color: '#3a3a38', fontSize: 10 }}>{formatSize(fileSize)}</span>
          )}

          {isTextFile && (
            <>
              {isDirty && (
                <button
                  type="button"
                  style={modeButtonStyle(false)}
                  onClick={handleDiscardChanges}
                  title="Discard unsaved changes"
                >
                  Discard
                </button>
              )}
              <button
                type="button"
                style={modeButtonStyle(false)}
                onClick={() => { void handleSave() }}
                title={viewMode === 'diff' ? 'Apply changes' : 'Review diff before save'}
              >
                {isSaving ? 'Saving...' : viewMode === 'diff' ? 'Apply' : 'Review'}
              </button>
            </>
          )}
          {hasStagedImageProposal && (
            <>
              <button
                type="button"
                style={modeButtonStyle(false)}
                onClick={handleDiscardChanges}
                title="Discard staged image update"
              >
                Discard
              </button>
              <button
                type="button"
                style={modeButtonStyle(false)}
                onClick={() => {
                  if (viewMode !== 'diff') {
                    setViewMode('diff')
                    return
                  }
                  void handleApplyImageProposal()
                }}
                title={viewMode === 'diff' ? 'Apply staged image update' : 'Review staged image diff'}
              >
                {isSaving ? 'Saving...' : viewMode === 'diff' ? 'Apply' : 'Review'}
              </button>
            </>
          )}
          {hasStagedPdfProposal && (
            <>
              <button
                type="button"
                style={modeButtonStyle(false)}
                onClick={handleDiscardChanges}
                title="Discard staged PDF update"
              >
                Discard
              </button>
              <button
                type="button"
                style={modeButtonStyle(false)}
                onClick={() => {
                  if (viewMode !== 'diff') {
                    setViewMode('diff')
                    return
                  }
                  void handleApplyPdfProposal()
                }}
                title={viewMode === 'diff' ? 'Apply staged PDF update' : 'Review staged PDF diff'}
              >
                {isSaving ? 'Saving...' : viewMode === 'diff' ? 'Apply' : 'Review'}
              </button>
            </>
          )}
        </div>
      )}

      {proposalNotice && !error && (
        <div
          style={{
            padding: '6px 10px',
            borderBottom: '1px solid rgba(89,86,83,0.2)',
            color: '#d4a040',
            fontSize: 11,
          }}
        >
          {proposalNotice}
        </div>
      )}

      {/* Editor/preview area */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {body}
      </div>

      {/* Status bar */}
      {filePath && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '2px 10px',
          borderTop: '1px solid rgba(89,86,83,0.2)',
          fontSize: 10,
          color: '#3a3a38',
          flexShrink: 0,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {filePath}
          </span>
          <span>{statusMessage}</span>
        </div>
      )}
    </div>
  )
}
