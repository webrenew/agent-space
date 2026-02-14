/**
 * useLspBridge — React hook that manages LSP server lifecycle for the editor.
 *
 * Automatically starts/stops the correct language server based on the file's
 * language, sends document open/close/change notifications, and applies
 * incoming diagnostics as Monaco markers.
 */

import { useEffect, useRef, useCallback } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

export function useLspBridge(
  filePath: string | null,
  languageId: string,
  monacoRef: React.MutableRefObject<Monaco | null>,
  editorRef: React.MutableRefObject<editor.IStandaloneCodeEditor | null>,
): { notifyChange: (content: string) => void } {
  const serverIdRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)
  const versionRef = useRef(0)
  const pendingRef = useRef<Map<number, {
    resolve: (v: unknown) => void
    reject: (e: Error) => void
  }>>(new Map())

  // Start LSP server when language changes
  useEffect(() => {
    if (!filePath || languageId === 'plaintext') return
    const activeFilePath = filePath

    let cancelled = false

    async function startLsp(): Promise<void> {
      try {
        const result = await window.electronAPI.lsp.start(languageId)
        if (cancelled || !result) return
        serverIdRef.current = result.serverId

        // Send initialize request
        const initId = ++requestIdRef.current
        const initMsg = {
          jsonrpc: '2.0',
          id: initId,
          method: 'initialize',
          params: {
            processId: null,
            capabilities: {
              textDocument: {
                synchronization: {
                  dynamicRegistration: false,
                  willSave: false,
                  didSave: true,
                  willSaveWaitUntil: false,
                },
                completion: {
                  completionItem: {
                    snippetSupport: true,
                    commitCharactersSupport: true,
                    documentationFormat: ['markdown', 'plaintext'],
                  },
                },
                hover: { contentFormat: ['markdown', 'plaintext'] },
                signatureHelp: {
                  signatureInformation: {
                    documentationFormat: ['markdown', 'plaintext'],
                  },
                },
                publishDiagnostics: { relatedInformation: true },
              },
            },
            rootUri: `file://${activeFilePath.split('/').slice(0, -1).join('/')}`,
          },
        }
        await window.electronAPI.lsp.send(result.serverId, initMsg)

        // Send initialized notification, then open the document
        setTimeout(async () => {
          if (cancelled || !serverIdRef.current) return
          await window.electronAPI.lsp.send(serverIdRef.current, {
            jsonrpc: '2.0',
            method: 'initialized',
            params: {},
          })

          if (editorRef.current) {
            versionRef.current = 1
            await window.electronAPI.lsp.send(serverIdRef.current, {
              jsonrpc: '2.0',
              method: 'textDocument/didOpen',
              params: {
                textDocument: {
                  uri: `file://${activeFilePath}`,
                  languageId,
                  version: versionRef.current,
                  text: editorRef.current.getValue(),
                },
              },
            })
          }
        }, 300)
      } catch (err) {
        console.error('[useLspBridge] LSP start failed:', err)
      }
    }

    void startLsp()

    return () => {
      cancelled = true
      if (serverIdRef.current) {
        void window.electronAPI.lsp.send(serverIdRef.current, {
          jsonrpc: '2.0',
          method: 'textDocument/didClose',
          params: { textDocument: { uri: `file://${activeFilePath}` } },
        }).catch(() => { /* ignore shutdown errors */ })
      }
    }
  }, [filePath, languageId, editorRef])

  // Listen for LSP responses/notifications → apply diagnostics
  useEffect(() => {
    const unsub = window.electronAPI.lsp.onMessage(({ serverId, message }) => {
      if (serverId !== serverIdRef.current) return
      const msg = message as Record<string, unknown>

      // Handle responses to our numbered requests
      if (typeof msg['id'] === 'number' && pendingRef.current.has(msg['id'] as number)) {
        const promise = pendingRef.current.get(msg['id'] as number)
        pendingRef.current.delete(msg['id'] as number)
        if (msg['error']) {
          promise?.reject(
            new Error(String((msg['error'] as Record<string, unknown>)?.['message'] ?? 'LSP error')),
          )
        } else {
          promise?.resolve(msg['result'])
        }
        return
      }

      // Handle publishDiagnostics notification → Monaco markers
      if (msg['method'] === 'textDocument/publishDiagnostics') {
        const params = msg['params'] as {
          uri: string
          diagnostics: Array<{
            range: {
              start: { line: number; character: number }
              end: { line: number; character: number }
            }
            severity?: number
            message: string
            source?: string
            code?: string | number
          }>
        }

        if (!monacoRef.current || !editorRef.current) return
        const model = editorRef.current.getModel()
        if (!model) return

        const monaco = monacoRef.current
        const markers = params.diagnostics.map((d) => ({
          severity:
            d.severity === 1 ? monaco.MarkerSeverity.Error
            : d.severity === 2 ? monaco.MarkerSeverity.Warning
            : d.severity === 3 ? monaco.MarkerSeverity.Info
            : monaco.MarkerSeverity.Hint,
          message: d.message,
          startLineNumber: d.range.start.line + 1,
          startColumn: d.range.start.character + 1,
          endLineNumber: d.range.end.line + 1,
          endColumn: d.range.end.character + 1,
          source: d.source,
        }))

        monaco.editor.setModelMarkers(model, 'lsp', markers)
      }
    })

    return unsub
  }, [monacoRef, editorRef])

  // Notify LSP of content changes (full-document sync)
  const notifyChange = useCallback((content: string) => {
    if (!serverIdRef.current || !filePath) return
    versionRef.current++
    void window.electronAPI.lsp.send(serverIdRef.current, {
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri: `file://${filePath}`, version: versionRef.current },
        contentChanges: [{ text: content }],
      },
    }).catch((err: unknown) => {
      console.error('[useLspBridge] didChange failed:', err)
    })
  }, [filePath])

  return { notifyChange }
}
