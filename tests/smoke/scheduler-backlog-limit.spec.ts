import { expect, test } from '@playwright/test'
import { __testOnlyBoundPendingCronQueueByLimit } from '../../src/main/scheduler'

test('scheduler backlog cap drops oldest queue entries first', () => {
  const queue = ['m1', 'm2', 'm3', 'm4', 'm5']
  const bounded = __testOnlyBoundPendingCronQueueByLimit(queue, 2)

  expect(bounded.keptQueue).toEqual(['m4', 'm5'])
  expect(bounded.droppedQueue).toEqual(['m1', 'm2', 'm3'])
})

test('scheduler backlog cap keeps queue intact when under limit', () => {
  const queue = ['m1', 'm2']
  const bounded = __testOnlyBoundPendingCronQueueByLimit(queue, 4)

  expect(bounded.keptQueue).toEqual(['m1', 'm2'])
  expect(bounded.droppedQueue).toEqual([])
})

test('scheduler backlog cap normalizes invalid limits to one entry', () => {
  const queue = ['m1', 'm2', 'm3']
  const bounded = __testOnlyBoundPendingCronQueueByLimit(queue, 0)

  expect(bounded.keptQueue).toEqual(['m3'])
  expect(bounded.droppedQueue).toEqual(['m1', 'm2'])
})
