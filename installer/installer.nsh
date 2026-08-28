; TideCode keeps the operating system's native NSIS pages and controls.
; The generated header and sidebar bitmaps provide the brand without replacing
; the installer with a custom-styled interface.

!define TIDECODE_REMOTE_FIREWALL_RULE "TideCode Remote"
!define TIDECODE_REMOTE_FIREWALL_REGKEY "Software\TideCode\Remote"

; Append TideCode's bin directory only when the selected PATH does not already
; contain that exact entry. StrCmp is case-insensitive, matching Windows path
; semantics, and the comparison tolerates a trailing backslash.
!macro addTideCodeBinToPath ROOT REGKEY
  !define UniqueID ${__LINE__}
  ReadRegStr $0 ${ROOT} "${REGKEY}" "Path"
  StrCpy $1 "$INSTDIR\resources\bin"
  StrCpy $2 "$0"

  tidecode_path_entry_${UniqueID}:
    StrCpy $3 ""
    StrCpy $4 0

  tidecode_path_char_${UniqueID}:
    StrCpy $5 $2 1 $4
    StrCmp $5 "" tidecode_path_compare_${UniqueID}
    StrCmp $5 ";" tidecode_path_compare_${UniqueID}
    StrCpy $3 "$3$5"
    IntOp $4 $4 + 1
    Goto tidecode_path_char_${UniqueID}

  tidecode_path_compare_${UniqueID}:
    StrCpy $6 $3 1 -1
    StrCmp $6 "\" 0 tidecode_path_compare_ready_${UniqueID}
    StrCpy $3 $3 -1

  tidecode_path_compare_ready_${UniqueID}:
    StrCmp $3 $1 tidecode_path_done_${UniqueID}
    StrCmp $5 "" tidecode_path_append_${UniqueID}
    IntOp $4 $4 + 1
    StrCpy $2 $2 "" $4
    Goto tidecode_path_entry_${UniqueID}

  tidecode_path_append_${UniqueID}:
    ${if} $0 == ""
      WriteRegExpandStr ${ROOT} "${REGKEY}" "Path" "$1"
    ${else}
      WriteRegExpandStr ${ROOT} "${REGKEY}" "Path" "$0;$1"
    ${endif}

  tidecode_path_done_${UniqueID}:
  !undef UniqueID
!macroend

!macro customWelcomePage
  ; An updater launch already has the user's approval. A manually launched
  ; installer with an existing install should also go directly to the native
  ; install-mode page, where the upgrade/reinstall state is explained.
  !define UniqueID ${__LINE__}
  Function skipWelcomeIfAlreadyInstalled_${UniqueID}
    ${if} ${isUpdated}
      Abort
    ${elseif} $hasPerUserInstallation == "1"
    ${orIf} $hasPerMachineInstallation == "1"
      Abort
    ${endif}
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_PRE skipWelcomeIfAlreadyInstalled_${UniqueID}
  !undef UniqueID

  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  ; electron-builder normally detects an existing install from
  ; Software\${APP_GUID}\InstallLocation. Older TideCode installers may
  ; have only written the Windows uninstall entry, so recover the install
  ; directory from its DisplayIcon value when the primary record is absent.
  StrCpy $R3 "0"
  StrCpy $R4 "0"

  ${if} $hasPerUserInstallation == "0"
    ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayIcon
    ${if} $0 != ""
      ; electron-builder writes the icon as <executable>,0.
      StrCpy $1 $0 2 -2
      ${if} $1 == ",0"
        StrCpy $0 $0 -2
      ${endif}
      ${StdUtils.GetParentPath} $2 "$0"
      ${if} ${FileExists} "$2\${APP_EXECUTABLE_FILENAME}"
        StrCpy $perUserInstallationFolder "$2"
        StrCpy $hasPerUserInstallation "1"
        StrCpy $R3 "1"
      ${endif}
    ${endif}
  ${endif}

  ${if} $hasPerMachineInstallation == "0"
    ReadRegStr $0 HKLM "${UNINSTALL_REGISTRY_KEY}" DisplayIcon
    ${if} $0 != ""
      StrCpy $1 $0 2 -2
      ${if} $1 == ",0"
        StrCpy $0 $0 -2
      ${endif}
      ${StdUtils.GetParentPath} $2 "$0"
      ${if} ${FileExists} "$2\${APP_EXECUTABLE_FILENAME}"
        StrCpy $perMachineInstallationFolder "$2"
        StrCpy $hasPerMachineInstallation "1"
        StrCpy $R4 "1"
      ${endif}
    ${endif}
  ${endif}

  ; Keep the native installer controls aligned with a recovered install
  ; without re-reading the missing primary registry value and losing the
  ; path we just recovered.
  ${if} $R3 == "1"
    StrCpy $installMode CurrentUser
    SetShellVarContext current
    StrCpy $INSTDIR $perUserInstallationFolder
  ${elseif} $R4 == "1"
    StrCpy $installMode all
    SetShellVarContext all
    StrCpy $INSTDIR $perMachineInstallationFolder
  ${endif}
!macroend

!macro customPageAfterChangeDir
  ; Keep the native directory picker while leaving electron-builder's
  ; shortcut-preservation path enabled for manual reinstalls. The built-in
  ; directory page is disabled in the config because that option also tells
  ; electron-builder to remove and recreate shortcuts during upgrades.
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_DIRECTORY
!macroend

!macro customInstallmode
  ; Preserve the existing per-user or per-machine installation mode during
  ; an in-app update without asking the user to choose it a second time.
  ; Fresh installs and manually launched installers keep the native choice
  ; page so the user can choose the installation mode and destination.
  ${if} ${isUpdated}
    ${if} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  ${endif}
!macroend

!macro customInstall
  ; Register TideCode bin directory in user or machine PATH
  ${if} $installMode == "all"
    !insertmacro addTideCodeBinToPath HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
  ${else}
    !insertmacro addTideCodeBinToPath HKCU "Environment"
  ${endif}

  ; Register the packaged TideCode executable for inbound Remote TCP access on
  ; trusted Windows network profiles. The rule is program-scoped instead of
  ; port-scoped so changing the Remote port in Settings keeps working. A marker
  ; prevents repeated UAC prompts during normal in-app updates while still
  ; migrating existing installations the first time they receive this build.
  StrCpy $R5 ""
  ${if} $installMode == "all"
    ReadRegStr $R5 HKLM "${TIDECODE_REMOTE_FIREWALL_REGKEY}" "FirewallRuleInstalled"
  ${else}
    ReadRegStr $R5 HKCU "${TIDECODE_REMOTE_FIREWALL_REGKEY}" "FirewallRuleInstalled"
  ${endif}

  ${if} $R5 != "1"
    ClearErrors
    ExecShellWait "runas" "$SYSDIR\netsh.exe" 'advfirewall firewall add rule name="${TIDECODE_REMOTE_FIREWALL_RULE}" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=private,domain protocol=TCP' SW_HIDE
    ${if} ${Errors}
      DetailPrint "TideCode Remote firewall access was not registered."
    ${else}
      ${if} $installMode == "all"
        WriteRegStr HKLM "${TIDECODE_REMOTE_FIREWALL_REGKEY}" "FirewallRuleInstalled" "1"
      ${else}
        WriteRegStr HKCU "${TIDECODE_REMOTE_FIREWALL_REGKEY}" "FirewallRuleInstalled" "1"
      ${endif}
    ${endif}
  ${endif}

  ; electron-updater starts a non-silent installer for the user-visible
  ; update flow. Once the files are installed, launch the new app and close
  ; NSIS directly instead of showing a finish page or waiting for a click.
  ${if} ${isUpdated}
    HideWindow
    StrCpy $1 "--updated"
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    SetErrorLevel 0
    Quit
  ${endif}
!macroend

!macro customUnInstall
  ; Remove only the firewall rule created for this installed TideCode binary.
  ; Per-user uninstallers can still request elevation specifically for netsh.
  ClearErrors
  ExecShellWait "runas" "$SYSDIR\netsh.exe" 'advfirewall firewall delete rule name="${TIDECODE_REMOTE_FIREWALL_RULE}" program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"' SW_HIDE

  DeleteRegValue HKCU "${TIDECODE_REMOTE_FIREWALL_REGKEY}" "FirewallRuleInstalled"
  DeleteRegKey /ifempty HKCU "${TIDECODE_REMOTE_FIREWALL_REGKEY}"
  DeleteRegValue HKLM "${TIDECODE_REMOTE_FIREWALL_REGKEY}" "FirewallRuleInstalled"
  DeleteRegKey /ifempty HKLM "${TIDECODE_REMOTE_FIREWALL_REGKEY}"
!macroend
