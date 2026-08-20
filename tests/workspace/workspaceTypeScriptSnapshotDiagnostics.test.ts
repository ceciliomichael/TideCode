import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import {
  clearWorkspaceTypeScriptProjectCache,
  getWorkspaceTypeScriptProject,
} from '../../electron/workspace/typescriptProject'
import {
  createWorkspaceMonacoModelPath,
  createWorkspaceMonacoTypeScriptFilePath,
} from '../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoConfig'
import { createWorkspaceMonacoTypeScriptCompilerOptions } from '../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoTypeScriptConfig'

function isTypeScriptScriptFile(filePath: string) {
  return /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/iu.test(filePath)
}

function createVirtualDirectories(workspaceRootPath: string, filePaths: Iterable<string>) {
  const directories = new Set<string>([path.resolve(workspaceRootPath)])
  for (const filePath of filePaths) {
    let currentDirectory = path.dirname(filePath)
    while (currentDirectory === workspaceRootPath || currentDirectory.startsWith(workspaceRootPath + path.sep)) {
      directories.add(currentDirectory)
      if (currentDirectory === workspaceRootPath) break
      currentDirectory = path.dirname(currentDirectory)
    }
  }
  return directories
}

function flattenDiagnosticMessage(messageText: string | ts.DiagnosticMessageChain) {
  return ts.flattenDiagnosticMessageText(messageText, '\n')
}

test('workspace TypeScript snapshot resolves App.tsx like a project instead of an isolated Monaco file', async () => {
  const workspaceRootPath = process.cwd()
  clearWorkspaceTypeScriptProjectCache()
  const snapshot = await getWorkspaceTypeScriptProject({
    relativePath: 'src/App.tsx',
    workspaceRootPath,
  })

  assert.equal(snapshot.truncated, false)

  const conversion = ts.convertCompilerOptionsFromJson(snapshot.compilerOptions, workspaceRootPath)
  assert.equal(
    conversion.errors.length,
    0,
    conversion.errors.map((diagnostic) => flattenDiagnosticMessage(diagnostic.messageText)).join('\n'),
  )
  const compilerOptions: ts.CompilerOptions = {
    ...conversion.options,
    allowNonTsExtensions: true,
    noEmit: true,
  }

  const filesByAbsolutePath = new Map(
    snapshot.files.map((file) => [path.resolve(workspaceRootPath, file.filePath), file.content]),
  )
  const scriptFileNames = Array.from(filesByAbsolutePath.keys()).filter(isTypeScriptScriptFile)
  const virtualDirectories = createVirtualDirectories(workspaceRootPath, filesByAbsolutePath.keys())
  const defaultLibPath = ts.getDefaultLibFilePath(compilerOptions)
  const typescriptLibDirectory = path.dirname(defaultLibPath)
  const isTypeScriptLibPath = (filePath: string) => {
    const absolutePath = path.resolve(filePath)
    return absolutePath === typescriptLibDirectory || absolutePath.startsWith(typescriptLibDirectory + path.sep)
  }

  const moduleResolutionHost: ts.ModuleResolutionHost = {
    directoryExists: (directoryName) =>
      virtualDirectories.has(path.resolve(directoryName)) ||
      (isTypeScriptLibPath(directoryName) && (ts.sys.directoryExists?.(directoryName) ?? false)),
    fileExists: (fileName) =>
      filesByAbsolutePath.has(path.resolve(fileName)) ||
      (isTypeScriptLibPath(fileName) && ts.sys.fileExists(fileName)),
    getCurrentDirectory: () => workspaceRootPath,
    getDirectories: (directoryName) => {
      const absoluteDirectory = path.resolve(directoryName)
      if (isTypeScriptLibPath(absoluteDirectory)) {
        return ts.sys.getDirectories?.(absoluteDirectory) ?? []
      }
      const prefix = absoluteDirectory + path.sep
      return Array.from(virtualDirectories)
        .filter((candidate) => candidate.startsWith(prefix))
        .map((candidate) => candidate.slice(prefix.length))
        .filter((candidate) => candidate.length > 0 && !candidate.includes(path.sep))
    },
    readFile: (fileName) =>
      filesByAbsolutePath.get(path.resolve(fileName)) ??
      (isTypeScriptLibPath(fileName) ? ts.sys.readFile(fileName) : undefined),
    realpath: (fileName) => path.resolve(fileName),
  }

  const languageServiceHost: ts.LanguageServiceHost = {
    ...moduleResolutionHost,
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: () => defaultLibPath,
    getScriptFileNames: () => scriptFileNames,
    getScriptSnapshot: (fileName) => {
      const content = moduleResolutionHost.readFile?.(fileName)
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
    },
    getScriptVersion: () => '1',
    resolveModuleNames: (moduleNames, containingFile) =>
      moduleNames.map((moduleName) =>
        ts.resolveModuleName(moduleName, containingFile, compilerOptions, moduleResolutionHost).resolvedModule,
      ),
  }

  const languageService = ts.createLanguageService(languageServiceHost)
  try {
    const activeFilePath = path.resolve(workspaceRootPath, 'src/App.tsx')
    const diagnostics = [
      ...languageService.getSyntacticDiagnostics(activeFilePath),
      ...languageService.getSemanticDiagnostics(activeFilePath),
    ]
    const unresolvedModuleDiagnostics = diagnostics.filter((diagnostic) =>
      diagnostic.code === 2307 || diagnostic.code === 7016,
    )

    assert.deepEqual(
      unresolvedModuleDiagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: flattenDiagnosticMessage(diagnostic.messageText),
      })),
      [],
    )
  } finally {
    languageService.dispose()
  }
})

test('workspace Monaco virtual project resolves local modules and React package typings', async () => {
  const workspaceRootPath = process.cwd()
  clearWorkspaceTypeScriptProjectCache()
  const snapshot = await getWorkspaceTypeScriptProject({
    relativePath: 'src/App.tsx',
    workspaceRootPath,
  })

  const filesByVirtualPath = new Map(
    snapshot.files.map((file) => [createWorkspaceMonacoTypeScriptFilePath(file.filePath), file.content]),
  )

  const host: ts.ModuleResolutionHost = {
    fileExists: (fileName) => filesByVirtualPath.has(fileName.replace(/\\/gu, '/')),
getCurrentDirectory: () => '',
    readFile: (fileName) => filesByVirtualPath.get(fileName.replace(/\\/gu, '/')),
    realpath: (fileName) => fileName.replace(/\\/gu, '/'),
  }
  const compilerOptions = createWorkspaceMonacoTypeScriptCompilerOptions(snapshot) as ts.CompilerOptions
  const containingFile = createWorkspaceMonacoModelPath('src/App.tsx')

  assert.equal(
    createWorkspaceMonacoTypeScriptFilePath('node_modules/@types/react/index.d.ts'),
        'file:///workspace/node_modules/@types/react/index.d.ts',
  )

  const localModule = ts.resolveModuleName(
    './components/settings/settingsItems',
    containingFile,
    compilerOptions,
    host,
  ).resolvedModule
  const reactModule = ts.resolveModuleName('react', containingFile, compilerOptions, host).resolvedModule

  assert.ok(localModule, 'expected local module to resolve in Monaco virtual workspace')
  assert.ok(reactModule, 'expected react to resolve in Monaco virtual workspace')
  assert.match(localModule.resolvedFileName, /src\/components\/settings\/settingsItems\.ts$/u)
  assert.match(reactModule.resolvedFileName, /node_modules\/@types\/react\/(?:ts5\.0\/)?index\.d\.ts$/u)
})
