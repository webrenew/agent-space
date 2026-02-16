import { test, expect } from '@playwright/test'
import {
  applyStagedPdfProposal,
  applyStagedImageProposal,
  discardStagedPdfProposal,
  discardStagedImageProposal,
  stagePdfProposal,
  stageImageProposal,
  unavailableNonTextDiffMessage,
} from '../../src/renderer/lib/non-text-diff'

test('image proposal workflow stages diff and applies new payload', () => {
  const current = 'data:image/png;base64,AAAA'
  const proposed = 'data:image/png;base64,BBBB'

  const staged = stageImageProposal(current, proposed)
  expect(staged.notice).toBeNull()
  expect(staged.next.stagedProposal?.dataUrl).toBe(proposed)

  const applied = applyStagedImageProposal(staged.next)
  expect(applied.currentDataUrl).toBe(proposed)
  expect(applied.stagedProposal).toBeNull()
})

test('image proposal workflow can discard staged proposal', () => {
  const current = 'data:image/png;base64,AAAA'
  const proposed = 'data:image/png;base64,BBBB'

  const staged = stageImageProposal(current, proposed)
  const discarded = discardStagedImageProposal(staged.next)

  expect(discarded.currentDataUrl).toBe(current)
  expect(discarded.stagedProposal).toBeNull()
})

test('invalid image proposal content returns actionable notice', () => {
  const current = 'data:image/png;base64,AAAA'

  const staged = stageImageProposal(current, 'not-a-data-url')
  expect(staged.next.stagedProposal).toBeNull()
  expect(staged.notice).toContain('base64 data URL')
})

test('pdf proposal workflow stages semantic diff payload and applies new asset', () => {
  const current = 'data:application/pdf;base64,JVBERi0xLjM='
  const proposed = 'data:application/pdf;base64,JVBERi0xLjQ='
  const proposalPayload = JSON.stringify({
    dataUrl: proposed,
    currentText: 'Quarterly summary\nRevenue: 10',
    proposedText: 'Quarterly summary\nRevenue: 12',
  })

  const staged = stagePdfProposal(current, proposalPayload)
  expect(staged.notice).toBeNull()
  expect(staged.next.stagedProposal?.dataUrl).toBe(proposed)
  expect(staged.next.stagedProposal?.currentText).toContain('Revenue: 10')
  expect(staged.next.stagedProposal?.proposedText).toContain('Revenue: 12')

  const applied = applyStagedPdfProposal(staged.next)
  expect(applied.currentDataUrl).toBe(proposed)
  expect(applied.stagedProposal).toBeNull()
})

test('pdf proposal workflow can discard staged proposal', () => {
  const current = 'data:application/pdf;base64,JVBERi0xLjM='
  const proposed = 'data:application/pdf;base64,JVBERi0xLjQ='
  const proposalPayload = JSON.stringify({
    dataUrl: proposed,
    currentText: 'before',
    proposedText: 'after',
  })

  const staged = stagePdfProposal(current, proposalPayload)
  const discarded = discardStagedPdfProposal(staged.next)
  expect(discarded.currentDataUrl).toBe(current)
  expect(discarded.stagedProposal).toBeNull()
})

test('pdf proposal payload validation returns actionable notice', () => {
  const current = 'data:application/pdf;base64,JVBERi0xLjM='
  const staged = stagePdfProposal(current, JSON.stringify({
    dataUrl: current,
    proposedText: 'missing currentText',
  }))

  expect(staged.next.stagedProposal).toBeNull()
  expect(staged.notice).toContain('currentText')
  expect(staged.notice).toContain('proposedText')
})

test('unsupported non-text formats provide explicit fallback guidance', () => {
  const message = unavailableNonTextDiffMessage('pdf', 'quarterly-report.pdf')
  expect(message).toContain('PDF')
  expect(message).toContain('external tool')
})

test('office binary formats include conversion fallback guidance', () => {
  const message = unavailableNonTextDiffMessage('binary', 'roadmap.docx')
  expect(message).toContain('DOCX')
  expect(message).toContain('Convert')
})
