import fs from 'fs'
import os from 'os'
import path from 'path'
import type {
  AppSettings,
  ClaudeProfile,
  ClaudeProfilesConfig,
  ClaudeSettingSource,
  ClaudeWorkspaceProfileRule,
} from '../renderer/types'
import { getSettings } from './settings'

export interface ResolvedClaudeProfile {
  profile: ClaudeProfile
  source: 'rule' | 'default' | 'fallback'
  matchedRulePathPrefix: string | null
  cliArgs: string[]
  missingPathWarnings: string[]
}

const FALLBACK_PROFILE: ClaudeProfile = {
  id: 'default',
  name: 'Default',
  settingsPath: '',
  mcpConfigPath: '',
  pluginDirs: [],
  settingSources: ['user', 'project', 'local'],
  agent: '',
  permissionMode: 'default',
  strictMcpConfig: false,
}

function expandUserPath(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  return path.resolve(trimmed)
}

function normalizePathPrefix(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const normalized = expandUserPath(trimmed).replace(/\\/g, '/')
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

function pathMatchesPrefix(absolutePath: string, prefix: string): boolean {
  if (absolutePath === prefix) return true
  return absolutePath.startsWith(`${prefix}/`)
}

function uniqueSettingSources(sources: ClaudeSettingSource[]): ClaudeSettingSource[] {
  const seen = new Set<ClaudeSettingSource>()
  const ordered: ClaudeSettingSource[] = []
  for (const value of sources) {
    if (value !== 'user' && value !== 'project' && value !== 'local') continue
    if (seen.has(value)) continue
    seen.add(value)
    ordered.push(value)
  }
  return ordered.length > 0 ? ordered : ['user', 'project', 'local']
}

function normalizeProfile(profile: ClaudeProfile | null | undefined): ClaudeProfile {
  if (!profile) return { ...FALLBACK_PROFILE }
  const id = profile.id?.trim() || FALLBACK_PROFILE.id
  const name = profile.name?.trim() || id
  return {
    id,
    name,
    settingsPath: profile.settingsPath?.trim() ?? '',
    mcpConfigPath: profile.mcpConfigPath?.trim() ?? '',
    pluginDirs: (profile.pluginDirs ?? []).map((entry) => entry.trim()).filter(Boolean),
    settingSources: uniqueSettingSources(profile.settingSources ?? []),
    agent: profile.agent?.trim() ?? '',
    permissionMode: profile.permissionMode ?? 'default',
    strictMcpConfig: profile.strictMcpConfig === true,
  }
}

function normalizeProfilesConfig(settings: AppSettings): ClaudeProfilesConfig {
  const config = settings.claudeProfiles
  if (!config) {
    return {
      defaultProfileId: FALLBACK_PROFILE.id,
      profiles: [{ ...FALLBACK_PROFILE }],
      workspaceRules: [],
    }
  }

  const profiles = (config.profiles ?? [])
    .map((profile) => normalizeProfile(profile))
    .filter((profile, index, list) => list.findIndex((entry) => entry.id === profile.id) === index)
  if (profiles.length === 0) profiles.push({ ...FALLBACK_PROFILE })

  const profileIds = new Set(profiles.map((profile) => profile.id))
  const defaultProfileId = profileIds.has(config.defaultProfileId) ? config.defaultProfileId : profiles[0].id
  const workspaceRules = (config.workspaceRules ?? [])
    .map((rule): ClaudeWorkspaceProfileRule | null => {
      if (!rule || typeof rule !== 'object') return null
      const pathPrefix = normalizePathPrefix(rule.pathPrefix)
      if (!pathPrefix) return null
      const profileId = rule.profileId?.trim() ?? ''
      if (!profileIds.has(profileId)) return null
      return {
        id: rule.id?.trim() || `rule-${profileId}-${pathPrefix}`,
        pathPrefix,
        profileId,
      }
    })
    .filter((rule): rule is ClaudeWorkspaceProfileRule => Boolean(rule))

  return {
    defaultProfileId,
    profiles,
    workspaceRules,
  }
}

function resolveProfileByWorkspace(
  config: ClaudeProfilesConfig,
  workingDirectory: string | null
): { profile: ClaudeProfile; source: 'rule' | 'default' | 'fallback'; matchedRulePathPrefix: string | null } {
  if (!workingDirectory) {
    const defaultProfile = config.profiles.find((profile) => profile.id === config.defaultProfileId) ?? config.profiles[0]
    return { profile: defaultProfile, source: 'default', matchedRulePathPrefix: null }
  }

  const normalizedWorkingDirectory = normalizePathPrefix(workingDirectory) ?? workingDirectory.replace(/\\/g, '/')
  const sortedRules = [...config.workspaceRules].sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)
  for (const rule of sortedRules) {
    if (!pathMatchesPrefix(normalizedWorkingDirectory, rule.pathPrefix)) continue
    const matchedProfile = config.profiles.find((profile) => profile.id === rule.profileId)
    if (matchedProfile) {
      return {
        profile: matchedProfile,
        source: 'rule',
        matchedRulePathPrefix: rule.pathPrefix,
      }
    }
  }

  const defaultProfile = config.profiles.find((profile) => profile.id === config.defaultProfileId) ?? config.profiles[0]
  return { profile: defaultProfile, source: 'default', matchedRulePathPrefix: null }
}

function appendPathArg(
  args: string[],
  warnings: string[],
  flag: '--settings' | '--mcp-config',
  value: string,
  label: string
): void {
  const normalized = expandUserPath(value)
  if (!fs.existsSync(normalized)) {
    warnings.push(`${label} not found: ${normalized}`)
    return
  }
  args.push(flag, normalized)
}

export function resolveClaudeProfileForDirectory(workingDirectory?: string | null): ResolvedClaudeProfile {
  const settings = getSettings()
  const config = normalizeProfilesConfig(settings)
  const resolved = resolveProfileByWorkspace(config, workingDirectory ?? null)
  const profile = normalizeProfile(resolved.profile)
  const cliArgs: string[] = []
  const missingPathWarnings: string[] = []

  if (profile.settingsPath) {
    appendPathArg(cliArgs, missingPathWarnings, '--settings', profile.settingsPath, 'Profile settings')
  }
  if (profile.mcpConfigPath) {
    appendPathArg(cliArgs, missingPathWarnings, '--mcp-config', profile.mcpConfigPath, 'Profile MCP config')
  }

  const pluginDirs = profile.pluginDirs
    .map((entry) => expandUserPath(entry))
    .filter((entry) => {
      if (!fs.existsSync(entry)) {
        missingPathWarnings.push(`Profile plugin dir not found: ${entry}`)
        return false
      }
      try {
        return fs.statSync(entry).isDirectory()
      } catch {
        missingPathWarnings.push(`Profile plugin dir is not a directory: ${entry}`)
        return false
      }
    })
  if (pluginDirs.length > 0) {
    cliArgs.push('--plugin-dir', ...pluginDirs)
  }

  if (profile.settingSources.length > 0) {
    cliArgs.push('--setting-sources', profile.settingSources.join(','))
  }
  if (profile.agent) {
    cliArgs.push('--agent', profile.agent)
  }
  if (profile.permissionMode) {
    cliArgs.push('--permission-mode', profile.permissionMode)
  }
  if (profile.strictMcpConfig) {
    cliArgs.push('--strict-mcp-config')
  }

  return {
    profile,
    source: resolved.source,
    matchedRulePathPrefix: resolved.matchedRulePathPrefix,
    cliArgs,
    missingPathWarnings,
  }
}
