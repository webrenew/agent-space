import type {
  ClaudeProfile,
  ClaudeProfilesConfig,
  ClaudeWorkspaceProfileRule,
} from '../types'

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

function normalizePathPrefix(input: string): string | null {
  const normalized = input.trim().replace(/\\/g, '/')
  if (!normalized) return null
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

function pathMatchesPrefix(absolutePath: string, prefix: string): boolean {
  if (absolutePath === prefix) return true
  return absolutePath.startsWith(`${prefix}/`)
}

function normalizeConfig(config: ClaudeProfilesConfig | undefined): ClaudeProfilesConfig {
  if (!config) {
    return {
      defaultProfileId: FALLBACK_PROFILE.id,
      profiles: [{ ...FALLBACK_PROFILE }],
      workspaceRules: [],
    }
  }

  const profiles = config.profiles.length > 0 ? config.profiles : [{ ...FALLBACK_PROFILE }]
  const defaultProfileId = profiles.some((profile) => profile.id === config.defaultProfileId)
    ? config.defaultProfileId
    : profiles[0].id
  const profileIds = new Set(profiles.map((profile) => profile.id))
  const workspaceRules = config.workspaceRules.filter((rule) => profileIds.has(rule.profileId))

  return { defaultProfileId, profiles, workspaceRules }
}

export function resolveClaudeProfile(
  config: ClaudeProfilesConfig | undefined,
  workingDirectory: string | null
): { profile: ClaudeProfile; source: 'rule' | 'default' | 'fallback'; matchedRule: ClaudeWorkspaceProfileRule | null } {
  const normalizedConfig = normalizeConfig(config)
  const defaultProfile = normalizedConfig.profiles.find((profile) => profile.id === normalizedConfig.defaultProfileId)
    ?? normalizedConfig.profiles[0]
    ?? FALLBACK_PROFILE

  if (!workingDirectory) {
    return {
      profile: defaultProfile,
      source: defaultProfile.id === FALLBACK_PROFILE.id ? 'fallback' : 'default',
      matchedRule: null,
    }
  }

  const normalizedWorkingDirectory = normalizePathPrefix(workingDirectory)
  if (!normalizedWorkingDirectory) {
    return { profile: defaultProfile, source: 'default', matchedRule: null }
  }

  const sortedRules = [...normalizedConfig.workspaceRules]
    .map((rule) => ({ rule, prefix: normalizePathPrefix(rule.pathPrefix) }))
    .filter((entry): entry is { rule: ClaudeWorkspaceProfileRule; prefix: string } => Boolean(entry.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)

  for (const entry of sortedRules) {
    if (!pathMatchesPrefix(normalizedWorkingDirectory, entry.prefix)) continue
    const profile = normalizedConfig.profiles.find((candidate) => candidate.id === entry.rule.profileId)
    if (profile) {
      return { profile, source: 'rule', matchedRule: entry.rule }
    }
  }

  return {
    profile: defaultProfile,
    source: defaultProfile.id === FALLBACK_PROFILE.id ? 'fallback' : 'default',
    matchedRule: null,
  }
}
