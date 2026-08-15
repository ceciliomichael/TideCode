@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"

if exist "%~dp0\..\TideCode.exe" (
  "%~dp0\..\TideCode.exe" "%~dp0\..\resources\app.asar\dist-electron\cli\index.js" %*
) else if exist "%~dp0\..\dist-electron\cli\index.js" (
  node "%~dp0\..\dist-electron\cli\index.js" %*
) else (
  npx tsx "%~dp0\..\electron\cli\index.ts" %*
)

endlocal
