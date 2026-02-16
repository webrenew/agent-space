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

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
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

export function parseImageProposalContent(content: string): StagedImageProposal | null {
  const candidate = extractDataUrlFromProposalPayload(content)
  if (!candidate) return null

  const match = /^data:(image\/[^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(candidate)
  if (!match) return null
  const base64Payload = match[2]
  const estimatedSize = Math.max(
    0,
    Math.floor((base64Payload.length * 3) / 4) - (base64Payload.endsWith('==') ? 2 : base64Payload.endsWith('=') ? 1 : 0)
  )

  return {
    dataUrl: candidate,
    mimeType: match[1],
    size: estimatedSize,
  }
}

export function unavailableNonTextDiffMessage(kind: NonTextPreviewKind, fileName: string): string {
  const ext = extension(fileName)
  const extLabel = ext ? ext.toUpperCase() : 'THIS'

  if (kind === 'pdf' || kind === 'audio' || kind === 'video' || kind === 'binary') {
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
