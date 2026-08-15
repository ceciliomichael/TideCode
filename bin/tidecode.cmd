@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
set "SCRIPT_DIR=%~dp0"
set "INSTALL_DIR=%SCRIPT_DIR%..\.."
set "CLI_RUNTIME=%SCRIPT_DIR%..\cli"

rem Installed layout: TideCode/resources/bin/tidecode.cmd and TideCode/TideCode.exe.
if exist "%CLI_RUNTIME%\node.exe" if exist "%CLI_RUNTIME%\index.mjs" (
  set "ELECTRON_RUN_AS_NODE="
  set "APP_ROOT=%CLI_RUNTIME%"
  set "TIDECODE_RESOURCES_PATH=%SCRIPT_DIR%.."
  "%CLI_RUNTIME%\node.exe" "%CLI_RUNTIME%\index.mjs" %*
) else if exist "%INSTALL_DIR%\TideCode.exe" (
  "%INSTALL_DIR%\TideCode.exe" "%INSTALL_DIR%\resources\app.asar\dist-electron\cli\index.js" %*
) else if exist "%SCRIPT_DIR%..\dist-electron\cli\index.js" (
  node "%SCRIPT_DIR%..\dist-electron\cli\index.js" %*
) else if exist "%SCRIPT_DIR%..\electron\cli\index.ts" (
  npx tsx "%SCRIPT_DIR%..\electron\cli\index.ts" %*
) else (
  echo TideCode CLI is not available in this installation. 1>&2
  exit /b 1
)

endlocal
