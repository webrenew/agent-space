import { test, expect } from '@playwright/test'
import { __testOnlyDecodeDataUrlPayload } from '../../src/main/filesystem'

test('data-url decoder extracts mime type and byte size', () => {
  const decoded = __testOnlyDecodeDataUrlPayload('data:image/png;base64,AAAA')
  expect(decoded.mimeType).toBe('image/png')
  expect(decoded.size).toBe(3)
})

test('data-url decoder rejects malformed payloads', () => {
  expect(() => __testOnlyDecodeDataUrlPayload('not-a-data-url')).toThrow('Invalid data URL payload')
  expect(() => __testOnlyDecodeDataUrlPayload('data:image/png;base64,***')).toThrow('Invalid data URL payload')
})
