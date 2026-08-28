export type SkillSource = 'global' | 'workspace'

export interface SkillSummary {
  baseDirectory: string
  description: string
  id: string
  location: string
  name: string
  source: SkillSource
  sourceLabel: string
}

export interface SkillsState {
  errorMessage: string | null
  skills: SkillSummary[]
}

export interface CreateSkillInput {
  name: string
  description: string
  content: string
}

export interface SkillDetails extends SkillSummary {
  content: string
}

export interface TideCodeSkillsApi {
  listSkills: (workspacePath?: string | null) => Promise<SkillsState>
  createSkill: (
    input: CreateSkillInput,
    workspacePath?: string | null,
  ) => Promise<{ error?: string; skill?: SkillSummary }>
  loadSkill: (
    skillName: string,
    workspacePath?: string | null,
  ) => Promise<{ error?: string; skill?: SkillDetails }>
  updateSkill: (
    location: string,
    input: CreateSkillInput,
    workspacePath?: string | null,
  ) => Promise<{ error?: string; skill?: SkillSummary }>
}
