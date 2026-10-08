import { useMcpServersState } from '../hooks/useMcpServersState'
import { useSkillsState } from '../hooks/useSkillsState'
import { SettingsInterface, type SettingsInterfaceProps } from './SettingsInterface'

type SettingsScreenProps = Omit<SettingsInterfaceProps, 'mcpSettings' | 'skillsState'> & {
  activeWorkspacePath: string | null
}

export default function SettingsScreen({ activeWorkspacePath, ...settingsInterfaceProps }: SettingsScreenProps) {
  const mcpSettings = useMcpServersState(activeWorkspacePath)
  const skillsState = useSkillsState(activeWorkspacePath)

  return (
    <SettingsInterface
      {...settingsInterfaceProps}
      mcpSettings={mcpSettings}
      skillsState={skillsState}
    />
  )
}
