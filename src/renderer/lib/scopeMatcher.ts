import type { Scope } from '../types'

function expandHome(dir: string): string {
  if (dir.startsWith('~/') || dir === '~') {
    // In Electron renderer, HOME env var or /Users/<user> from cwd
    const home = typeof process !== 'undefined' ? process.env.HOME ?? '' : ''
    if (home) return dir.replace('~', home)
  }
  return dir
}

function normalizePath(p: string): string {
  return p.endsWith('/') ? p : p + '/'
}

/**
 * Match a cwd against configured scopes using prefix matching.
 * Returns the first matching scope, or null if none match.
 */
export function matchScope(cwd: string, scopes: Scope[]): Scope | null {
  const normalizedCwd = normalizePath(cwd)

  for (const scope of scopes) {
    for (const dir of scope.directories) {
      const expanded = normalizePath(expandHome(dir))
      if (normalizedCwd.startsWith(expanded)) {
        return scope
      }
    }
  }

  return null
}
