import type { Scope } from '../types'

function inferHomeFromCwd(cwd: string): string | null {
  const usersMatch = cwd.match(/^\/Users\/[^/]+/)
  if (usersMatch) return usersMatch[0]

  const homeMatch = cwd.match(/^\/home\/[^/]+/)
  if (homeMatch) return homeMatch[0]

  return null
}

function expandHome(dir: string, cwd: string): string {
  if (dir.startsWith('~/') || dir === '~') {
    const home = inferHomeFromCwd(cwd) ?? ''
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
      const expanded = normalizePath(expandHome(dir, cwd))
      if (normalizedCwd.startsWith(expanded)) {
        return scope
      }
    }
  }

  return null
}
