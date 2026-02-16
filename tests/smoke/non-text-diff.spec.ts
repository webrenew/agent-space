import { test, expect } from '@playwright/test'
import {
  applyStagedImageProposal,
  discardStagedImageProposal,
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

test('unsupported non-text formats provide explicit fallback guidance', () => {
  const message = unavailableNonTextDiffMessage('pdf', 'quarterly-report.pdf')
  expect(message).toContain('PDF')
  expect(message).toContain('external tool')
})
