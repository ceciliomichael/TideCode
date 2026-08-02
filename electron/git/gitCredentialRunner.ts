import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { getErrorMessage } from './repositoryContext'

const execFileAsync = promisify(execFile)
const GIT_EXECUTION_OPTIONS = {
  encoding: 'utf8' as const,
  maxBuffer: 1024 * 1024,
  windowsHide: true,
}
function createWindowsAskPassScript() {
  return [
    '@echo off',
    'echo %1 | findstr /I "Username" >nul',
    'if not errorlevel 1 (echo x-access-token) else (echo %TIDECODE_GIT_ACCESS_TOKEN%)',
  ].join('\r\n')
}

function createPosixAskPassScript() {
  return ['#!/bin/sh', 'case "$1" in', '  *Username*) printf \'%s\\n\' "x-access-token" ;;', '  *) printf \'%s\\n\' "$TIDECODE_GIT_ACCESS_TOKEN" ;;', 'esac'].join('\n')
}

export async function runGitWithAccessToken(args: string[], cwd: string, accessToken: string) {
  if (accessToken.trim().length === 0) {
    throw new Error('GitHub access token is required for the Git push.')
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-git-auth-'))
  const scriptPath = path.join(temporaryDirectory, process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh')

  try {
    await fs.writeFile(
      scriptPath,
      process.platform === 'win32' ? createWindowsAskPassScript() : createPosixAskPassScript(),
      { encoding: 'utf8', mode: 0o700 },
    )

    const result = await execFileAsync('git', args, {
      ...GIT_EXECUTION_OPTIONS,
      cwd,
      env: {
        ...process.env,
        GIT_ASKPASS: scriptPath,
        GIT_TERMINAL_PROMPT: '0',
        TIDECODE_GIT_ACCESS_TOKEN: accessToken,
      },
    })

    return result
  } catch (error) {
    throw new Error(getErrorMessage(error))
  } finally {
    await fs.rm(temporaryDirectory, { force: true, recursive: true }).catch(() => undefined)
  }
}
