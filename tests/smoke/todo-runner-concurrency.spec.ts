import { expect, test } from '@playwright/test'
import {
  __testOnlyCollectStaleRunningTodoIndices,
  __testOnlyComputeTodoRunnerAvailableSlots,
  __testOnlyFindNextRunnableTodoIndex,
} from '../../src/main/todo-runner'

test('slow-spawn reservation consumes slot before process bookkeeping updates', () => {
  const maxConcurrentJobs = 1

  // Initial state: no running jobs and no pending starts.
  expect(__testOnlyComputeTodoRunnerAvailableSlots(maxConcurrentJobs, 0, 0)).toBe(1)

  // Simulated slow spawn: launch is reserved but process has not reached onSpawned yet.
  expect(__testOnlyComputeTodoRunnerAvailableSlots(maxConcurrentJobs, 0, 1)).toBe(0)

  // After spawn callback moves reservation into the running map, capacity remains full.
  expect(__testOnlyComputeTodoRunnerAvailableSlots(maxConcurrentJobs, 1, 0)).toBe(0)

  // Capacity returns only after the running todo exits.
  expect(__testOnlyComputeTodoRunnerAvailableSlots(maxConcurrentJobs, 0, 0)).toBe(1)
})

test('available slots are clamped and count running plus pending starts', () => {
  expect(__testOnlyComputeTodoRunnerAvailableSlots(3, 0, 0)).toBe(3)
  expect(__testOnlyComputeTodoRunnerAvailableSlots(3, 1, 1)).toBe(1)
  expect(__testOnlyComputeTodoRunnerAvailableSlots(3, 2, 1)).toBe(0)
  expect(__testOnlyComputeTodoRunnerAvailableSlots(2, 4, 4)).toBe(0)
})

test('candidate selection is pure and does not mutate running todos', () => {
  const todos = [
    { status: 'running' as const, attempts: 0 },
    { status: 'pending' as const, attempts: 0 },
  ]
  const before = structuredClone(todos)
  const nextIndex = __testOnlyFindNextRunnableTodoIndex(todos)

  expect(nextIndex).toBe(1)
  expect(todos).toEqual(before)
})

test('stale running reconciliation targets only running statuses', () => {
  const staleIndexes = __testOnlyCollectStaleRunningTodoIndices([
    { status: 'running' as const },
    { status: 'pending' as const },
    { status: 'done' as const },
    { status: 'running' as const },
  ])
  expect(staleIndexes).toEqual([0, 3])
})
