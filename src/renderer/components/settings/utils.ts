export function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return 'Never'
  return new Date(timestamp).toLocaleString()
}

export function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) return '0s'
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainderSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainderSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainderMinutes = minutes % 60
  return `${hours}h ${remainderMinutes}m`
}

export function runStatusColor(
  lastStatus: 'idle' | 'running' | 'success' | 'error',
  isRunning: boolean
): string {
  if (isRunning || lastStatus === 'running') return '#d4a040'
  if (lastStatus === 'success') return '#548C5A'
  if (lastStatus === 'error') return '#c45050'
  return '#74747C'
}

export function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function todoItemsToText(items: string[]): string {
  return items.join('\n')
}

export function todoItemsFromText(value: string): string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
}
