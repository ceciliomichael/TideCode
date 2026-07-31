import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '../../src/types/chat'
import type { SkillSummary, SkillsState } from '../../src/types/skills'
import type { AgentToolExecutionResult } from '../chat/shared/toolTypes'

const SKILL_FILE_NAME = 'SKILL.md'
const GLOBAL_SKILL_DIRECTORIES = ['.echosphere/skills', '.codex/skills', '.agents/skills', '.claude/skills'] as const
const WORKSPACE_SKILL_DIRECTORIES = ['skills', '.echosphere/skills', '.codex/skills', '.agents/skills', '.claude/skills'] as const
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const SKILL_DISCOVERY_CACHE_TTL_MS = 3_000
const skillDiscoveryCache = new Map<string, { expiresAt: number; state: SkillsState }>()
const skillDiscoveryInFlight = new Map<string, Promise<SkillsState>>()

interface SkillSearchRoot {
  directory: string
  source: SkillSummary['source']
  sourceLabel: string
}

interface ParsedSkillDocument {
  content: string
  description: string
  name: string
}

export interface LoadedSkill extends SkillSummary {
  content: string
}

function normalizeWorkspacePath(workspacePath?: string | null) {
  const trimmed = workspacePath?.trim() ?? ''
  return trimmed.length > 0 ? path.resolve(trimmed) : null
}

function normalizeSkillLocation(location: string) {
  return path.resolve(location)
}


function normalizeFrontmatterValue(value: string) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }

  return trimmed
}

function parseFrontmatter(content: string) {
  const match = content.match(FRONTMATTER_PATTERN)
  if (!match) {
    return {
      body: content.trim(),
      metadata: {} as Record<string, string>,
    }
  }

  const metadata: Record<string, string> = {}
  for (const rawLine of match[1].split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = normalizeFrontmatterValue(line.slice(separatorIndex + 1))
    if (key.length === 0 || value.length === 0) {
      continue
    }

    metadata[key] = value
  }

  return {
    body: content.slice(match[0].length).trim(),
    metadata,
  }
}

function deriveSkillDescription(body: string, metadata: Record<string, string>) {
  const frontmatterDescription = metadata.description?.trim()
  if (frontmatterDescription) {
    return frontmatterDescription
  }

  const firstParagraphLine = body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'))

  return firstParagraphLine ?? 'No description provided.'
}

function parseSkillDocument(content: string, location: string): ParsedSkillDocument {
  const { body, metadata } = parseFrontmatter(content)
  const fallbackName = path.basename(path.dirname(location))
  const name = metadata.name?.trim() || fallbackName

  return {
    content: body.length > 0 ? body : content.trim(),
    description: deriveSkillDescription(body, metadata),
    name,
  }
}

function getSearchRoots(workspacePath?: string | null): SkillSearchRoot[] {
  const roots: SkillSearchRoot[] = []
  const seenDirectories = new Set<string>()
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)

  const pushRoot = (directory: string, source: SkillSummary['source'], sourceLabel: string) => {
    const normalizedDirectory = path.resolve(directory)
    if (seenDirectories.has(normalizedDirectory)) {
      return
    }

    seenDirectories.add(normalizedDirectory)
    roots.push({
      directory: normalizedDirectory,
      source,
      sourceLabel,
    })
  }

  if (normalizedWorkspacePath) {
    for (const relativeDirectory of WORKSPACE_SKILL_DIRECTORIES) {
      pushRoot(path.join(normalizedWorkspacePath, relativeDirectory), 'workspace', 'Workspace')
    }
  }

  const homeDirectory = os.homedir()
  for (const relativeDirectory of GLOBAL_SKILL_DIRECTORIES) {
    pushRoot(path.join(homeDirectory, relativeDirectory), 'global', 'Global')
  }

  return roots
}

async function isDirectory(directoryPath: string) {
  try {
    const stats = await fs.stat(directoryPath)
    return stats.isDirectory()
  } catch {
    return false
  }
}

async function collectSkillFiles(rootDirectory: string): Promise<string[]> {
  const matches: string[] = []

  async function walk(directoryPath: string): Promise<void> {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name)
      if (entry.isSymbolicLink()) {
        continue
      }

      if (entry.isDirectory()) {
        await walk(absolutePath)
        continue
      }

      if (entry.isFile() && entry.name === SKILL_FILE_NAME) {
        matches.push(absolutePath)
      }
    }
  }

  await walk(rootDirectory)
  return matches
}

async function readSkillSummary(location: string, root: SkillSearchRoot): Promise<SkillSummary | null> {
  try {
    const normalizedLocation = normalizeSkillLocation(location)
    const rawContent = await fs.readFile(normalizedLocation, 'utf8')
    const parsed = parseSkillDocument(rawContent, normalizedLocation)
    if (parsed.name.trim().length === 0) {
      return null
    }

    return {
      baseDirectory: path.dirname(normalizedLocation),
      description: parsed.description,
      id: normalizedLocation,
      location: normalizedLocation,
      name: parsed.name.trim(),
      source: root.source,
      sourceLabel: root.sourceLabel,
    }
  } catch {
    return null
  }
}

function dedupeSkills(skills: SkillSummary[]) {
  const skillsByName = new Map<string, SkillSummary>()
  for (const skill of skills) {
    const normalizedName = skill.name.trim().toLowerCase()
    if (normalizedName.length === 0 || skillsByName.has(normalizedName)) {
      continue
    }

    skillsByName.set(normalizedName, skill)
  }

  return Array.from(skillsByName.values()).sort((left, right) => left.name.localeCompare(right.name))
}

function isSkillEnabled(settings: AppSettings, skill: SkillSummary) {
  return settings.disabledSkillsByPath[skill.location] !== true
}

export function buildSkillsSystemPromptBlock() {
  return ''
}

export function buildSkillToolDescription() {
  return 'Manages and loads workspace skills.'
}

export function searchSkills(skills: SkillSummary[], query: string): SkillSummary[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return skills
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter((token) => token.length > 0)

  return skills.filter((skill) => {
    const nameLower = skill.name.toLowerCase()
    const descLower = skill.description.toLowerCase()

    return queryTokens.every((token) => nameLower.includes(token) || descLower.includes(token))
  })
}

export function paginateSkills(skills: SkillSummary[], page: number = 1, pageSize: number = 10) {
  const validPage = Math.max(1, Math.floor(page))
  const totalSkills = skills.length
  const totalPages = Math.max(1, Math.ceil(totalSkills / pageSize))
  const currentPage = Math.min(validPage, totalPages)

  const startIndex = (currentPage - 1) * pageSize
  const paginatedItems = skills.slice(startIndex, startIndex + pageSize)

  return {
    currentPage,
    items: paginatedItems,
    pageSize,
    totalPages,
    totalSkills,
  }
}

async function discoverAvailableSkills(workspacePath?: string | null): Promise<SkillsState> {
  try {
    const discoveredSkills: SkillSummary[] = []

    for (const root of getSearchRoots(workspacePath)) {
      if (!(await isDirectory(root.directory))) {
        continue
      }

      const files = await collectSkillFiles(root.directory)
      for (const file of files) {
        const skill = await readSkillSummary(file, root)
        if (skill) {
          discoveredSkills.push(skill)
        }
      }
    }

    return {
      errorMessage: null,
      skills: dedupeSkills(discoveredSkills),
    }
  } catch (error) {
    return {
      errorMessage: error instanceof Error && error.message.trim().length > 0 ? error.message : 'Unable to load skills.',
      skills: [],
    }
  }
}

export async function listAvailableSkills(workspacePath?: string | null): Promise<SkillsState> {
  const cacheKey = normalizeWorkspacePath(workspacePath) ?? ''
  const cached = skillDiscoveryCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.state
  }

  const activeDiscovery = skillDiscoveryInFlight.get(cacheKey)
  if (activeDiscovery) {
    return activeDiscovery
  }

  const discovery = discoverAvailableSkills(workspacePath)
    .then((state) => {
      skillDiscoveryCache.set(cacheKey, {
        expiresAt: Date.now() + SKILL_DISCOVERY_CACHE_TTL_MS,
        state,
      })
      return state
    })
    .finally(() => {
      skillDiscoveryInFlight.delete(cacheKey)
    })
  skillDiscoveryInFlight.set(cacheKey, discovery)
  return discovery
}

export async function listEnabledSkills(workspacePath?: string | null) {
  const { getStoredSettings } = await import('../settings/store')
  const [skillsState, settings] = await Promise.all([listAvailableSkills(workspacePath), getStoredSettings()])
  return skillsState.skills.filter((skill) => isSkillEnabled(settings, skill))
}

export async function loadEnabledSkillByName(
  skillName: string,
  workspacePath?: string | null,
  enabledSkills?: SkillSummary[],
): Promise<LoadedSkill | null> {
  const normalizedSkillName = skillName.trim().toLowerCase()
  if (normalizedSkillName.length === 0) {
    return null
  }

  const skills = enabledSkills ?? (await listEnabledSkills(workspacePath))
  const skill = skills.find((candidate) => candidate.name.trim().toLowerCase() === normalizedSkillName)
  if (!skill) {
    return null
  }

  const rawContent = await fs.readFile(skill.location, 'utf8')
  const parsed = parseSkillDocument(rawContent, skill.location)

  return {
    ...skill,
    content: parsed.content,
  }
}

export function buildLoadedSkillResult(skill: LoadedSkill): AgentToolExecutionResult {
  return {
    body: [
      `Skill file: ${skill.location}`,
      `Skill directory: ${skill.baseDirectory}`,
      'Resolve relative resource and script paths from the skill directory above.',
      '',
      skill.content.trim(),
    ].join('\n'),
    semantics: {
      skill_directory: skill.baseDirectory,
      skill_file: skill.location,
      skill_name: skill.name,
    },
    status: 'success',
    subject: {
      kind: 'file',
      path: skill.location,
    },
    summary: `Loaded skill ${skill.name}`,
  }
}

export async function createSkill(
  input: { name: string; description: string; content: string },
  workspacePath?: string | null,
): Promise<{ error?: string; skill?: SkillSummary }> {
  const nameTrimmed = input.name.trim()
  const normalizedName = nameTrimmed.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()
  if (!normalizedName) {
    return { error: 'Skill name is required.' }
  }

  const normalizedDescription = input.description.trim()
  const rawContent = input.content.trim()

  const targetDir = path.join(os.homedir(), '.echosphere', 'skills', normalizedName)
  const skillFilePath = path.join(targetDir, SKILL_FILE_NAME)

  const fileText = [
    '---',
    `name: ${nameTrimmed}`,
    `description: ${normalizedDescription}`,
    '---',
    '',
    rawContent,
  ].join('\n')

  try {
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(skillFilePath, fileText, 'utf8')

    // Invalidate discovery cache
    skillDiscoveryCache.clear()

    const state = await discoverAvailableSkills(workspacePath)
    const resolvedPath = path.resolve(skillFilePath)
    const newSkill = state.skills.find((s) => s.location === resolvedPath)

    return {
      skill: newSkill ?? {
        baseDirectory: targetDir,
        description: normalizedDescription,
        id: skillFilePath,
        location: resolvedPath,
        name: nameTrimmed,
        source: 'global',
        sourceLabel: 'Global',
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to create skill file.' }
  }
}
