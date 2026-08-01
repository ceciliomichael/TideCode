!macro customHeader
  XPStyle on
  SetFont "Google Sans Flex" 9 400
!macroend

!macro customInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\GoogleSansFlex-Latin.ttf "${PROJECT_DIR}\installer\fonts\GoogleSansFlex-Latin.ttf"
  StrCpy $0 "$PLUGINSDIR\GoogleSansFlex-Latin.ttf"
  System::Call 'gdi32::AddFontResourceEx(t r0, i 0x10, i 0) i'
!macroend

!macro customInstallmode
  ${if} $hasPerMachineInstallation == "1"
    StrCpy $isForceMachineInstall "1"
  ${else}
    StrCpy $isForceCurrentInstall "1"
  ${endif}
!macroend

!macro customWelcomePage
  !define MUI_BGCOLOR "F7FAF9"
  !define MUI_TEXTCOLOR "0F4C5C"
  SetFont "Google Sans Flex" 9 400
  !define MUI_WELCOMEPAGE_TITLE "Welcome to TideCode"
  !define MUI_WELCOMEPAGE_TEXT "A calmer, more efficient workspace for building with AI.$\r$\n$\r$\nTideCode brings conversations, tools, files, and Git together so you can move from intent to reviewed change with fewer interruptions.$\r$\n$\r$\nYour settings and workspaces stay where they are. Updates install in place so your TideCode shortcut and taskbar pin keep pointing to the same app."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW TideCodeWelcomeShow
  !insertmacro MUI_PAGE_WELCOME
  Function TideCodeWelcomeShow
    ${if} $hasPerMachineInstallation == "1"
    ${orIf} $hasPerUserInstallation == "1"
      SendMessage $mui.WelcomePage.Title ${WM_SETTEXT} 0 "STR:TideCode is already here"
      SendMessage $mui.WelcomePage.Text ${WM_SETTEXT} 0 "STR:This installer will update TideCode in place.$\r$\n$\r$\nYour settings, workspaces, shortcut, and taskbar pin stay connected to the same TideCode installation.$\r$\n$\r$\nNothing in your projects is removed."
      SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:Update"
    ${else}
      SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:Install"
    ${endif}
  FunctionEnd
!macroend

!macro customPageAfterChangeDir
  !define MUI_INSTFILESPAGE_COLORS "2DD4BF F7FAF9"
  !define MUI_INSTFILESPAGE_PROGRESSBAR "smooth colored"
  !define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "TideCode is ready"
  !define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Your workspace is installed and ready to use."
  !define MUI_INSTFILESPAGE_ABORTHEADER_TEXT "Installation paused"
  !define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "TideCode was not fully installed."
  SetFont "Google Sans Flex" 9 400
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "TideCode is ready"
  !define MUI_FINISHPAGE_TEXT "TideCode is installed. Your workspace is ready for the next idea, fix, or release."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Open TideCode"
  !define MUI_FINISHPAGE_RUN_FUNCTION "TideCodeStartApp"

  Function TideCodeStartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !insertmacro MUI_PAGE_FINISH
!macroend
