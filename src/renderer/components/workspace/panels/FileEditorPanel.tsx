/**
 * FileEditorPanel — Monaco-based code editor with auto-LSP.
 *
 * Listens for `file:open` custom events (dispatched by Explorer/Search panels).
 * Automatically starts the correct LSP server based on file extension,
 * and wires diagnostics back into Monaco markers.
 */

import '../../../monaco-setup'
import { useState, useEffect, useRef, useCallback } from 'react'
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useLspBridge } from '../../../hooks/useLspBridge'
import { useSettingsStore } from '../../../store/settings'

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

// ── Binary detection ─────────────────────────────────────────────────

const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'webm',
  'zip', 'gz', 'tar', 'rar', '7z',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'exe', 'dll', 'so', 'dylib', 'node',
])

function isBinary(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return BINARY_EXTS.has(ext)
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
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

// ── Component ────────────────────────────────────────────────────────

export function FileEditorPanel() {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState(0)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [diagnosticCounts, setDiagnosticCounts] = useState({ errors: 0, warnings: 0 })

  const monacoRef = useRef<Monaco | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const savedContentRef = useRef<string>('')

  const fileName = filePath?.split('/').pop() ?? ''
  const lang = filePath ? detectLang(fileName) : 'plaintext'

  const { notifyChange } = useLspBridge(filePath, lang, monacoRef, editorRef)

  // Listen for file open events
  useEffect(() => {
    const handler = (e: Event): void => {
      const path = (e as CustomEvent<string>).detail
      if (path) setFilePath(path)
    }
    window.addEventListener('file:open', handler)
    return () => window.removeEventListener('file:open', handler)
  }, [])

  // Load file content
  useEffect(() => {
    if (!filePath) return

    const name = filePath.split('/').pop() ?? ''
    if (isBinary(name)) {
      setError('Binary file — cannot edit')
      setContent('')
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)
    setIsDirty(false)

    async function load(): Promise<void> {
      try {
        const result = await window.electronAPI.fs.readFile(filePath!)
        if (cancelled) return
        setContent(result.content)
        savedContentRef.current = result.content
        setFileSize(result.size)
      } catch (err) {
        if (cancelled) return
        console.error('[FileEditor] Load failed:', err)
        setError(`Failed to load: ${err instanceof Error ? err.message : 'unknown'}`)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [filePath])

  // Save handler
  const handleSave = useCallback(async () => {
    if (!filePath || !editorRef.current || isSaving) return
    const value = editorRef.current.getValue()
    setIsSaving(true)
    try {
      await window.electronAPI.fs.writeFile(filePath, value)
      savedContentRef.current = value
      setIsDirty(false)
    } catch (err) {
      console.error('[FileEditor] Save failed:', err)
    } finally {
      setIsSaving(false)
    }
  }, [filePath, isSaving])

  // Listen for Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        // Only handle if editor is focused
        if (editorRef.current?.hasTextFocus()) {
          e.preventDefault()
          e.stopPropagation()
          void handleSave()
        }
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [handleSave])

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

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    defineOrchidTheme(monaco)
    monaco.editor.setTheme('orchid-dark')

    // Configure TypeScript defaults for JSX/TSX
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

    const { appearance } = useSettingsStore.getState().settings
    editor.updateOptions({
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

  // Live-update Monaco when appearance settings change
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state) => {
      const ed = editorRef.current
      if (!ed) return
      const { fontFamily: ff, fontSize: fs } = state.settings.appearance
      ed.updateOptions({
        fontSize: fs,
        lineHeight: Math.round(fs * 1.54),
        fontFamily: ff,
      })
    })
    return unsub
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value === undefined) return
    setIsDirty(value !== savedContentRef.current)
    notifyChange(value)
  }, [notifyChange])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0E0E0D', color: '#9A9692' }}>
      {/* Header bar */}
      {filePath && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
          borderBottom: '1px solid rgba(89,86,83,0.2)', flexShrink: 0, fontSize: 12,
        }}>
          <span style={{ color: '#9A9692', fontWeight: 500 }}>
            {isDirty ? '● ' : ''}{fileName}
          </span>
          <span style={{
            color: langColor(lang), fontSize: 10, fontWeight: 600,
            padding: '1px 6px', background: `${langColor(lang)}15`, borderRadius: 3,
          }}>
            {lang}
          </span>
          <div style={{ flex: 1 }} />
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
          {isSaving && (
            <span style={{ color: '#548C5A', fontSize: 10 }}>saving...</span>
          )}
        </div>
      )}

      {/* Editor area */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {!filePath ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 24, color: '#3a3a38' }}>◻</span>
            <span style={{ color: '#595653', fontSize: 12 }}>Open a file to edit</span>
            <span style={{ color: '#3a3a38', fontSize: 10 }}>Use Explorer or ⌘P to search</span>
          </div>
        ) : isLoading ? (
          <div style={{ padding: 16, color: '#595653', fontSize: 12 }}>Loading...</div>
        ) : error ? (
          <div style={{ padding: 16, color: '#c45050', fontSize: 12 }}>{error}</div>
        ) : (
          <Editor
            height="100%"
            language={lang}
            value={content}
            theme="orchid-dark"
            onMount={handleEditorMount}
            onChange={handleEditorChange}
            options={{
              readOnly: false,
              automaticLayout: true,
            }}
          />
        )}
      </div>

      {/* Status bar */}
      {filePath && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '2px 10px', borderTop: '1px solid rgba(89,86,83,0.2)',
          fontSize: 10, color: '#3a3a38', flexShrink: 0,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {filePath}
          </span>
          <span>⌘S save</span>
        </div>
      )}
    </div>
  )
}
