const WORKSPACE_INSTRUCTIONS_REPO_PATH = 'AGENTS.md'

export function buildWorkspaceInstructionsBootstrapBlock() {
  return [
    '<workspace_instruction_bootstrap>',
    `- Before working with project files, you must read \`${WORKSPACE_INSTRUCTIONS_REPO_PATH}\`.`,
    `- \`${WORKSPACE_INSTRUCTIONS_REPO_PATH}\` contains repository instructions. Follow all applicable instructions in it for project work unless they conflict with higher-priority instructions.`,
    '</workspace_instruction_bootstrap>',
  ].join('\n')
}
