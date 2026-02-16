import { execFile } from 'child_process'
import os from 'os'
import path from 'path'

export interface SearchResult {
  path: string
  name: string
  isDirectory: boolean
}

interface IndexedSearchFile extends SearchResult {
  relPath: string
  relPathLower: string
  nameLower: string
  stemLower: string
  extLower: string
  depth: number
}

interface ParsedSearchQuery {
  normalized: string
  normalizedPath: string
  tokens: string[]
  pathTokens: string[]
  extHint: string
  hasPathHint: boolean
}

interface SearchIndexCacheEntry {
  files: IndexedSearchFile[]
  builtAt: number
  buildPromise?: Promise<IndexedSearchFile[]>
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '.cache', '.turbo', '__pycache__', '.venv', 'venv', '.tox',
  'target', '.gradle', '.idea', '.vscode', '.DS_Store',
  'coverage', '.nyc_output', '.parcel-cache', '.svelte-kit',
  'release', '.electron',
])

const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const MACOS_HOME_EXCLUDED_SEARCH_DIRS = [
  'Library',
  'Library/Containers',
  'Library/Group Containers',
  'Library/Application Support',
  'Library/Application Scripts',
]

const SEARCH_INDEX_TTL_MS = 15_000
const SEARCH_INDEX_MAX_FILES = 200_000
const SEARCH_INDEX_MAX_RESULTS = 200
const SEARCH_WORD_BOUNDARIES = '/._- '
const RG_MAX_BUFFER = 32 * 1024 * 1024
const FIND_MAX_BUFFER = 32 * 1024 * 1024

const searchIndexCache = new Map<string, SearchIndexCacheEntry>()

export function shouldIgnoreFilesystemEntry(name: string, isDirectory: boolean): boolean {
  if (isDirectory) return IGNORED_DIRS.has(name)
  return IGNORED_FILES.has(name) || name.startsWith('.')
}

export async function searchFiles(rootDir: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const resolved = path.resolve(rootDir)
  const parsedQuery = parseSearchQuery(query)
  if (!parsedQuery.normalized) return []

  const limit = clampSearchResultLimit(maxResults)
  const indexedFiles = await getCachedSearchIndex(resolved)
  const scoredMatches: Array<{ file: IndexedSearchFile; score: number }> = []

  for (const file of indexedFiles) {
    const score = scoreSearchCandidate(file, parsedQuery)
    if (score <= 0) continue
    scoredMatches.push({ file, score })
  }

  scoredMatches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.file.relPathLower.localeCompare(b.file.relPathLower)
  })

  return scoredMatches.slice(0, limit).map(({ file }) => ({
    path: file.path,
    name: file.name,
    isDirectory: false,
  }))
}

function clampSearchResultLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 50
  return Math.min(Math.floor(limit), SEARCH_INDEX_MAX_RESULTS)
}

function parseSearchQuery(query: string): ParsedSearchQuery {
  const normalizedPath = query
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')

  const normalized = normalizedPath.replace(/\s+/g, ' ').trim()
  const tokens = normalizedPath.split(/[\/\s]+/).filter(Boolean)
  const pathTokens = normalizedPath.includes('/')
    ? normalizedPath.split('/').filter(Boolean)
    : tokens
  const extHintMatch = normalizedPath.match(/\.([a-z0-9_+-]+)$/)

  return {
    normalized,
    normalizedPath,
    tokens,
    pathTokens,
    extHint: extHintMatch?.[1] ?? '',
    hasPathHint: normalizedPath.includes('/'),
  }
}

function isSearchBoundary(char: string | undefined): boolean {
  if (!char) return true
  return SEARCH_WORD_BOUNDARIES.includes(char)
}

function fuzzySubsequenceScore(query: string, text: string): number {
  if (!query || !text) return 0

  let q = 0
  let score = 0
  let firstMatch = -1
  let lastMatch = -2

  for (let i = 0; i < text.length && q < query.length; i++) {
    if (text[i] !== query[q]) continue

    if (firstMatch === -1) firstMatch = i

    score += 8
    if (lastMatch === i - 1) score += 12
    if (isSearchBoundary(text[i - 1])) score += 10
    if (i === 0) score += 6

    lastMatch = i
    q++
  }

  if (q !== query.length) return 0
  if (firstMatch >= 0) score += Math.max(0, 24 - firstMatch)
  return score
}

function scoreSearchCandidate(file: IndexedSearchFile, query: ParsedSearchQuery): number {
  const { normalized, normalizedPath, tokens, pathTokens, extHint, hasPathHint } = query
  const { nameLower, relPathLower, stemLower, extLower } = file

  let score = 0

  if (nameLower === normalized) score += 2400
  if (stemLower === normalized) score += 2200
  if (nameLower.startsWith(normalized)) score += 1500

  const fullNameIndex = nameLower.indexOf(normalized)
  if (fullNameIndex >= 0) score += 1100 - Math.min(550, fullNameIndex * 22)

  const fullPathIndex = relPathLower.indexOf(normalizedPath)
  if (fullPathIndex >= 0) score += 850 - Math.min(400, fullPathIndex * 8)

  if (hasPathHint) {
    let cursor = 0
    for (const token of pathTokens) {
      const tokenIndex = relPathLower.indexOf(token, cursor)
      if (tokenIndex < 0) return 0
      score += 140 - Math.min(100, tokenIndex - cursor)
      cursor = tokenIndex + token.length
    }
    score += 220
  }

  for (const token of tokens) {
    const tokenInName = nameLower.indexOf(token)
    const tokenInPath = relPathLower.indexOf(token)

    if (tokenInName < 0 && tokenInPath < 0) return 0

    if (tokenInName >= 0) {
      score += 200 - Math.min(130, tokenInName * 6)
      if (tokenInName === 0) score += 80
    } else {
      score += 110 - Math.min(80, tokenInPath * 2)
    }
  }

  const fuzzyName = fuzzySubsequenceScore(normalized, nameLower)
  const fuzzyPath = fuzzySubsequenceScore(normalizedPath, relPathLower)
  if (fuzzyName <= 0 && fuzzyPath <= 0) return 0

  score += fuzzyName * 4
  score += fuzzyPath * 2

  if (extHint && extLower === extHint) score += 160

  score -= file.depth * 5
  score -= Math.max(0, nameLower.length - normalized.length) * 2

  return score > 0 ? score : 0
}

async function getCachedSearchIndex(rootDir: string): Promise<IndexedSearchFile[]> {
  const cached = searchIndexCache.get(rootDir)
  const now = Date.now()

  if (cached?.buildPromise) return cached.buildPromise
  if (cached && now - cached.builtAt < SEARCH_INDEX_TTL_MS) {
    return cached.files
  }

  const buildPromise = buildSearchIndex(rootDir)
    .then((files) => {
      searchIndexCache.set(rootDir, { files, builtAt: Date.now() })
      return files
    })
    .catch((err) => {
      if (cached) {
        searchIndexCache.set(rootDir, cached)
      } else {
        searchIndexCache.delete(rootDir)
      }
      throw err
    })

  searchIndexCache.set(rootDir, {
    files: cached?.files ?? [],
    builtAt: cached?.builtAt ?? 0,
    buildPromise,
  })

  return buildPromise
}

async function buildSearchIndex(rootDir: string): Promise<IndexedSearchFile[]> {
  const relPaths = await listSearchablePaths(rootDir)
  const rootExcludedDirs = new Set(getRootSpecificSearchExclusions(rootDir).map((dir) => dir.toLowerCase()))
  const seen = new Set<string>()
  const files: IndexedSearchFile[] = []

  for (const relPathRaw of relPaths) {
    const relPath = normalizeRelativeSearchPath(relPathRaw)
    if (!relPath || seen.has(relPath) || shouldIgnoreInSearch(relPath, rootExcludedDirs)) continue
    seen.add(relPath)

    const name = path.posix.basename(relPath)
    const nameLower = name.toLowerCase()
    const extLower = path.posix.extname(name).slice(1).toLowerCase()
    const stemLower = extLower ? nameLower.slice(0, -(extLower.length + 1)) : nameLower
    const depth = Math.max(0, relPath.split('/').length - 1)
    const absPath = path.join(rootDir, relPath)

    files.push({
      path: absPath,
      name,
      isDirectory: false,
      relPath,
      relPathLower: relPath.toLowerCase(),
      nameLower,
      stemLower,
      extLower,
      depth,
    })

    if (files.length >= SEARCH_INDEX_MAX_FILES) break
  }

  return files
}

function normalizeRelativeSearchPath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) return ''
  return trimmed.replace(/\\/g, '/').replace(/^\.\//, '')
}

function getRootSpecificSearchExclusions(rootDir: string): string[] {
  if (process.platform !== 'darwin') return []

  const resolvedRoot = path.resolve(rootDir)
  const homeDir = path.resolve(os.homedir())
  const excludes = new Set<string>()

  for (const homeRelativeDir of MACOS_HOME_EXCLUDED_SEARCH_DIRS) {
    const absDir = path.join(homeDir, homeRelativeDir)
    if (!isPathInsideRoot(resolvedRoot, absDir)) continue

    const relDir = normalizeRelativeSearchPath(path.relative(resolvedRoot, absDir)).replace(/\/+$/, '')
    if (!relDir) continue
    excludes.add(relDir)
  }

  return Array.from(excludes)
}

function shouldIgnoreInSearch(relPath: string, rootExcludedDirs?: ReadonlySet<string>): boolean {
  const normalizedRelPath = normalizeRelativeSearchPath(relPath).toLowerCase()
  if (rootExcludedDirs && normalizedRelPath) {
    for (const excludedDir of rootExcludedDirs) {
      if (normalizedRelPath === excludedDir || normalizedRelPath.startsWith(`${excludedDir}/`)) return true
    }
  }

  const segments = relPath.split('/').filter(Boolean)
  if (segments.length === 0) return true

  const lastIndex = segments.length - 1
  for (let i = 0; i < lastIndex; i++) {
    if (IGNORED_DIRS.has(segments[i])) return true
  }
  return IGNORED_FILES.has(segments[lastIndex])
}

function isPathInsideRoot(rootDir: string, targetPath: string): boolean {
  const rel = path.relative(rootDir, targetPath)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function invalidateSearchIndexForPath(targetPath: string): void {
  const resolvedTarget = path.resolve(targetPath)
  for (const rootDir of searchIndexCache.keys()) {
    if (isPathInsideRoot(rootDir, resolvedTarget)) {
      searchIndexCache.delete(rootDir)
    }
  }
}

async function listSearchablePaths(rootDir: string): Promise<string[]> {
  try {
    return await listPathsWithRipgrep(rootDir)
  } catch (err) {
    console.warn('[filesystem] rg --files failed, falling back to find:', err)
    return await listPathsWithFind(rootDir)
  }
}

function listPathsWithRipgrep(rootDir: string): Promise<string[]> {
  const args = ['--files', '--hidden']
  const rootSpecificExcludes = getRootSpecificSearchExclusions(rootDir)
  for (const dir of IGNORED_DIRS) {
    args.push('--glob', `!**/${dir}/**`)
  }
  for (const relDir of rootSpecificExcludes) {
    args.push('--glob', `!${relDir}/**`)
  }
  for (const file of IGNORED_FILES) {
    args.push('--glob', `!**/${file}`)
  }

  return new Promise((resolve, reject) => {
    execFile('rg', args, { cwd: rootDir, maxBuffer: RG_MAX_BUFFER, timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${err.message}${stderr ? ` (${stderr.trim()})` : ''}`))
        return
      }
      resolve(stdout.split('\n').map((line) => line.trim()).filter(Boolean))
    })
  })
}

function listPathsWithFind(rootDir: string): Promise<string[]> {
  const args = [rootDir, '-type', 'f']
  const rootSpecificExcludes = getRootSpecificSearchExclusions(rootDir)
  for (const dir of IGNORED_DIRS) {
    args.push('-not', '-path', `*/${dir}/*`)
  }
  for (const relDir of rootSpecificExcludes) {
    args.push('-not', '-path', `${path.join(rootDir, relDir)}/*`)
  }
  for (const file of IGNORED_FILES) {
    args.push('-not', '-name', file)
  }

  return new Promise((resolve, reject) => {
    execFile('find', args, { maxBuffer: FIND_MAX_BUFFER, timeout: 10_000 }, (err, stdout) => {
      if (err) {
        reject(err)
        return
      }

      const relPaths = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((absPath) => normalizeRelativeSearchPath(path.relative(rootDir, absPath)))
        .filter((relPath) => relPath.length > 0 && !relPath.startsWith('../'))

      resolve(relPaths)
    })
  })
}
