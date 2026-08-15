; TideCode keeps the operating system's native NSIS pages and controls.
; The generated header and sidebar bitmaps provide the brand without replacing
; the installer with a custom-styled interface.

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
    ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
    ${if} $0 != ""
      WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0;$INSTDIR\resources\bin"
    ${endif}
  ${else}
    ReadRegStr $0 HKCU "Environment" "Path"
    ${if} $0 != ""
      WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR\resources\bin"
    ${else}
      WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR\resources\bin"
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
