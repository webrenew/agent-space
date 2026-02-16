export type NonTextPreviewKind = 'image' | 'audio' | 'video' | 'pdf' | 'binary'

export interface StagedImageProposal {
  dataUrl: string
  mimeType: string
  size: number
}

export interface ImageDiffWorkflowState {
  currentDataUrl: string
  stagedProposal: StagedImageProposal | null
}

export interface StagedPdfProposal {
  dataUrl: string
  mimeType: string
  size: number
  currentText: string
  proposedText: string
}

export interface PdfDiffWorkflowState {
  currentDataUrl: string
  stagedProposal: StagedPdfProposal | null
}

const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])
const PDF_PAYLOAD_REQUIREMENTS_MESSAGE = 'PDF diff preview requires JSON payload with `dataUrl`, `currentText`, and `proposedText`.'
const PDF_DATA_URL_REQUIREMENTS_MESSAGE = 'PDF diff preview requires a base64 `data:application/pdf` payload.'

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

interface ParsedDataUrlPayload {
  dataUrl: string
  mimeType: string
  size: number
}

function parseBase64DataUrl(dataUrl: string): ParsedDataUrlPayload | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim())
  if (!match) return null
  const base64Payload = match[2]
  const estimatedSize = Math.max(
    0,
    Math.floor((base64Payload.length * 3) / 4) - (base64Payload.endsWith('==') ? 2 : base64Payload.endsWith('=') ? 1 : 0)
  )
  return {
    dataUrl: dataUrl.trim(),
    mimeType: match[1],
    size: estimatedSize,
  }
}

function extractDataUrlFromProposalPayload(content: string): string | null {
  const trimmed = content.trim()
  if (trimmed.startsWith('data:')) return trimmed
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as { dataUrl?: unknown }
    return typeof parsed.dataUrl === 'string' ? parsed.dataUrl.trim() : null
  } catch {
    return null
  }
}

function parseJsonPayload(content: string): Record<string, unknown> | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function parseImageProposalContent(content: string): StagedImageProposal | null {
  const candidate = extractDataUrlFromProposalPayload(content)
  if (!candidate) return null

  const parsedDataUrl = parseBase64DataUrl(candidate)
  if (!parsedDataUrl || !parsedDataUrl.mimeType.startsWith('image/')) return null

  return {
    dataUrl: parsedDataUrl.dataUrl,
    mimeType: parsedDataUrl.mimeType,
    size: parsedDataUrl.size,
  }
}

export function unavailableNonTextDiffMessage(kind: NonTextPreviewKind, fileName: string): string {
  const ext = extension(fileName)
  const extLabel = ext ? ext.toUpperCase() : 'THIS'

  if (kind === 'pdf') {
    return `Diff preview is unavailable for ${extLabel} assets. Provide a JSON proposal with \`dataUrl\`, \`currentText\`, and \`proposedText\`, or compare in an external tool and apply manually.`
  }

  if (kind === 'binary' && OFFICE_EXTENSIONS.has(ext)) {
    return `Diff preview is unavailable for ${extLabel} assets. Convert both versions to text/markdown for inline diff review, or compare in an external document diff tool before applying manually.`
  }

  if (kind === 'audio' || kind === 'video' || kind === 'binary') {
    return `Diff preview is unavailable for ${extLabel} assets. Compare current/proposed files in an external tool, then apply the final file manually.`
  }

  return 'Diff preview is unavailable for this file type. Compare externally and apply manually.'
}

export function stageImageProposal(currentDataUrl: string, proposalContent: string): { next: ImageDiffWorkflowState; notice: string | null } {
  const staged = parseImageProposalContent(proposalContent)
  if (!staged) {
    return {
      next: {
        currentDataUrl,
        stagedProposal: null,
      },
      notice: 'Image diff preview requires a base64 data URL (`data:image/...`).',
    }
  }

  return {
    next: {
      currentDataUrl,
      stagedProposal: staged,
    },
    notice: null,
  }
}

export function stagePdfProposal(currentDataUrl: string, proposalContent: string): { next: PdfDiffWorkflowState; notice: string | null } {
  const payload = parseJsonPayload(proposalContent)
  if (!payload) {
    return {
      next: {
        currentDataUrl,
        stagedProposal: null,
      },
      notice: PDF_PAYLOAD_REQUIREMENTS_MESSAGE,
    }
  }

  const dataUrl = asOptionalString(payload.dataUrl)
  const currentText = asOptionalString(payload.currentText)
  const proposedText = (
    asOptionalString(payload.proposedText)
    ?? asOptionalString(payload.nextText)
    ?? asOptionalString(payload.text)
  )
  if (!dataUrl || currentText === null || proposedText === null) {
    return {
      next: {
        currentDataUrl,
        stagedProposal: null,
      },
      notice: PDF_PAYLOAD_REQUIREMENTS_MESSAGE,
    }
  }

  const parsedDataUrl = parseBase64DataUrl(dataUrl)
  if (!parsedDataUrl || parsedDataUrl.mimeType !== 'application/pdf') {
    return {
      next: {
        currentDataUrl,
        stagedProposal: null,
      },
      notice: PDF_DATA_URL_REQUIREMENTS_MESSAGE,
    }
  }

  return {
    next: {
      currentDataUrl,
      stagedProposal: {
        dataUrl: parsedDataUrl.dataUrl,
        mimeType: parsedDataUrl.mimeType,
        size: parsedDataUrl.size,
        currentText,
        proposedText,
      },
    },
    notice: null,
  }
}

export function applyStagedImageProposal(state: ImageDiffWorkflowState): ImageDiffWorkflowState {
  if (!state.stagedProposal) return state
  return {
    currentDataUrl: state.stagedProposal.dataUrl,
    stagedProposal: null,
  }
}

export function discardStagedImageProposal(state: ImageDiffWorkflowState): ImageDiffWorkflowState {
  return {
    currentDataUrl: state.currentDataUrl,
    stagedProposal: null,
  }
}

export function applyStagedPdfProposal(state: PdfDiffWorkflowState): PdfDiffWorkflowState {
  if (!state.stagedProposal) return state
  return {
    currentDataUrl: state.stagedProposal.dataUrl,
    stagedProposal: null,
  }
}

export function discardStagedPdfProposal(state: PdfDiffWorkflowState): PdfDiffWorkflowState {
  return {
    currentDataUrl: state.currentDataUrl,
    stagedProposal: null,
  }
}
