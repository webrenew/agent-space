import { expect, test } from '@playwright/test'
import { __testOnlyComputeTodoRunnerAvailableSlots } from '../../src/main/todo-runner'

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
