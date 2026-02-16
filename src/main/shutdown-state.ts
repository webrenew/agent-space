const APP_SHUTTING_DOWN_ERROR_CODE = 'APP_SHUTTING_DOWN'

let appShuttingDown = false

export class AppShuttingDownError extends Error {
  readonly code = APP_SHUTTING_DOWN_ERROR_CODE

  constructor(operation: string) {
    super(`[${APP_SHUTTING_DOWN_ERROR_CODE}] ${operation} is unavailable while app is shutting down`)
    this.name = 'AppShuttingDownError'
  }
}

export function markAppShuttingDown(): void {
  appShuttingDown = true
}

export function isAppShuttingDown(): boolean {
  return appShuttingDown
}

export function assertAppNotShuttingDown(operation: string): void {
  if (!isAppShuttingDown()) return
  throw new AppShuttingDownError(operation)
}

export function __testOnlyResetAppShutdownState(): void {
  appShuttingDown = false
}
