import { expect, test } from '@playwright/test'
import {
  __testOnlyCanDispatchTodoRun,
  __testOnlyWaitForTodoRunPromises,
} from '../../src/main/todo-runner'

test('todo-runner dispatch gating blocks starts while shutting down', () => {
  expect(__testOnlyCanDispatchTodoRun(false, false, false, false)).toBe(true)
  expect(__testOnlyCanDispatchTodoRun(true, false, false, false)).toBe(false)
  expect(__testOnlyCanDispatchTodoRun(false, true, false, false)).toBe(false)
  expect(__testOnlyCanDispatchTodoRun(false, false, true, false)).toBe(false)
  expect(__testOnlyCanDispatchTodoRun(false, false, false, true)).toBe(false)
})

test('todo-runner dispatch drain reports completion when all runs settle', async () => {
  let resolveRun: (() => void) | null = null
  const runPromise = new Promise<void>((resolve) => {
    resolveRun = resolve
  })

  const drainPromise = __testOnlyWaitForTodoRunPromises([runPromise], 200)
  expect(resolveRun).not.toBeNull()
  resolveRun?.()

  await expect(drainPromise).resolves.toEqual({
    drained: true,
    pendingCount: 0,
  })
})

test('todo-runner dispatch drain reports timeout when runs stay in-flight', async () => {
  const neverSettles = new Promise<void>(() => {})
  const result = await __testOnlyWaitForTodoRunPromises([neverSettles], 1)
  expect(result).toEqual({
    drained: false,
    pendingCount: 1,
  })
})
