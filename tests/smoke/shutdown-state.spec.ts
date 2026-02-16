import { expect, test } from '@playwright/test'
import {
  __testOnlyResetAppShutdownState,
  assertAppNotShuttingDown,
  markAppShuttingDown,
} from '../../src/main/shutdown-state'

test.afterEach(() => {
  __testOnlyResetAppShutdownState()
})

test('shutdown guard allows operations before shutdown starts', () => {
  expect(() => assertAppNotShuttingDown('scheduler:runNow')).not.toThrow()
})

test('shutdown guard throws deterministic APP_SHUTTING_DOWN error', () => {
  markAppShuttingDown()
  let thrown: unknown = null
  try {
    assertAppNotShuttingDown('claude:start')
  } catch (err) {
    thrown = err
  }

  expect(thrown).toBeInstanceOf(Error)
  expect(String((thrown as Error).message)).toContain('APP_SHUTTING_DOWN')
})
