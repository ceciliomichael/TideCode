import { mkdir, mkdtemp, writeFile, access, symlink, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import net from 'node:net'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createPdfFixture(pageCount = 12) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>'),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`
}

const resourceScenarioModule = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspacePdfPreviewView } from '/src/components/workspaceExplorer/workspacePdfPreview/WorkspacePdfPreviewView.tsx';
import { preloadWorkspaceMonacoRuntime } from '/src/lib/workspaceMonacoPreload.ts';
import { getShikiRuntime } from '/src/lib/shikiRuntime.ts';
let pdfRoot, pdfContainer;
export function mountPdf(dataUrl) {
  pdfContainer = document.createElement('div');
  Object.assign(pdfContainer.style, { position: 'fixed', inset: '40px', zIndex: '9999', background: 'white' });
  document.body.append(pdfContainer);
  pdfRoot = createRoot(pdfContainer);
  pdfRoot.render(React.createElement(WorkspacePdfPreviewView, { fileName: 'fixture.pdf', previewDataUrl: dataUrl, relativePath: 'fixture.pdf', tabKey: 'memory-fixture' }));
}
export function scrollPdf() {
  const viewport = pdfContainer.querySelector('.workspace-pdf-preview .overflow-auto');
  viewport.scrollTop = viewport.scrollHeight;
}
export function unmountPdf() {
  pdfRoot.unmount(); pdfContainer.remove(); pdfRoot = null; pdfContainer = null;
}
export async function exerciseMonaco() {
  const monaco = await preloadWorkspaceMonacoRuntime();
  const container = document.createElement('div');
  Object.assign(container.style, { position: 'fixed', inset: '40px', zIndex: '9999' });
  document.body.append(container);
  const model = monaco.editor.createModel('export const answer: number = 42', 'typescript');
  const editor = monaco.editor.create(container, { model, theme: 'tidecode-dark' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const highlighter = await getShikiRuntime();
  const languages = highlighter.getLoadedLanguages();
  const tokens = monaco.editor.tokenize(model.getValue(), 'typescript');
  highlighter.codeToTokens(model.getValue(), { lang: 'typescript', theme: 'github-light-default' });
  const tokensAfterChatHighlight = monaco.editor.tokenize(model.getValue(), 'typescript');
  const themePreserved = JSON.stringify(tokens) === JSON.stringify(tokensAfterChatHighlight);
  editor.dispose(); model.dispose(); container.remove();
  return { languages, tokens, themePreserved };
}
`


const interactionScenarioModule = String.raw`
import { useGitDiffSnapshot } from '/src/hooks/useGitDiffSnapshot.ts';
import { useInitializeChatHistory } from '/src/hooks/useInitializeChatHistory.ts';
import { ToolInvocationBlock } from '/src/components/chat/ToolInvocationBlock.tsx';
import { ConversationDiffFileItem } from '/src/components/chat/ConversationDiffFileItem.tsx';
import { VirtualizedConversationDiffFileList } from '/src/components/chat/VirtualizedConversationDiffFileList.tsx';
import { projectGitFileDiffScope } from '/src/lib/chatDiffs.ts';
import { persistAndStreamMessage } from '/src/hooks/chatMessageSendWorkflow.ts';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const paintOpportunity = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function assertResource(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
function createFixtureRoot() {
  const container = document.createElement('div');
  Object.assign(container.style, { height: '600px', width: '850px' });
  document.body.append(container);
  const root = createRoot(container);
  return { container, root, close() { root.unmount(); container.remove(); } };
}
export async function exerciseDemandLifecycle() {
  const fixture = createFixtureRoot();
  const calls = [];
  let lineCount = 1;
  let stagedCount = 2;
  let controller;
  let notify = () => {};
  const pendingContents = [];
  const renders = [];
  const firstWorkspace = 'C:/synthetic-demand';
  const secondWorkspace = 'C:/synthetic-demand-second';
  const noop = () => {};
  const asyncNoop = async () => {};
  window.tidecodeGit = {
    getDiffs: async (path, options) => {
      calls.push(options.includeContent);
      if (options.includeContent) {
        await new Promise(resolve => pendingContents.push({ path, resolve }));
      }
      return { hasRepository: true, fileDiffs: [{
        fileName: path === secondWorkspace ? 'second.ts' : 'fixture.ts',
        isStaged: true, isUnstaged: true, isUntracked: false,
        oldContent: null, indexContent: null, newContent: '',
        addedLineCount: lineCount, removedLineCount: 0,
        stagedLineCounts: { addedLineCount: stagedCount, removedLineCount: 1 },
        unstagedLineCounts: { addedLineCount: lineCount, removedLineCount: 3 },
      }] };
    },
    watchSourceControlChanges: async () => {},
    unwatchSourceControlChanges: async () => {},
    onSourceControlChange: listener => { notify = listener; return () => {}; },
  };
  function Probe({ includeContent, workspacePath = firstWorkspace, selectedScope = 'unstaged' }) {
    const [expanded, setExpanded] = React.useState(true);
    controller = useGitDiffSnapshot({ includeContent, pollingEnabled: true, hasRepository: true, workspacePath });
    renders.push({ workspacePath, names: controller.snapshot.fileDiffs.map(file => file.fileName) });
    if (!includeContent) return null;
    return React.createElement('div', null, controller.snapshot.fileDiffs.map(diff =>
      React.createElement(ConversationDiffFileItem, {
        key: diff.fileName, diff: projectGitFileDiffScope(diff, selectedScope), isExpanded: expanded, onExpandedChange: (_path, value) => setExpanded(value),
        onDiscardFile: asyncNoop, onPreloadDiff: asyncNoop, onPrewarmDiff: noop,
        onStageFile: asyncNoop, onUnstageFile: asyncNoop, pendingFileActionPath: null,
        selectedScope, shouldPrewarm: false, onPrewarmReady: noop,
      })));
  }
  function assertRowCounts(added, removed) {
    assertResource(fixture.container.querySelector('.text-git-added')?.textContent === '+' + added, 'Added count was missing or incorrect');
    assertResource(fixture.container.querySelector('.text-git-removed')?.textContent === '-' + removed, 'Removed count was missing or incorrect');
  }
  function releaseContent(workspacePath) {
    const index = pendingContents.findIndex(request => request.path === workspacePath);
    assertResource(index >= 0, 'Expected a pending full-content read for ' + workspacePath);
    pendingContents.splice(index, 1)[0].resolve();
  }
  fixture.root.render(React.createElement(Probe, { includeContent: false }));
  await pause(11000);
  assertResource(!calls.includes(true), 'Closed panels loaded full Git contents');
  const closedCalls = [...calls];
  lineCount = 7;
  notify({ workspacePath: 'C:/synthetic-demand' });
  await pause(200);
  assertResource(controller.snapshot.totalAddedLineCount === 7, 'Closed badge did not update when only line counts changed');
  stagedCount = 4;
  notify({ workspacePath: firstWorkspace });
  await pause(100);
  assertResource(controller.snapshot.fileDiffs[0]?.stagedLineCounts?.addedLineCount === 4, 'Scope-only count change was ignored');
  assertResource(controller.snapshot.totalAddedLineCount === 7, 'Scope-only update changed the combined count');
  fixture.root.render(React.createElement(Probe, { includeContent: true }));
  await pause(200);
  assertResource(calls.includes(true), 'Opening Diff did not request content');
  assertResource(controller.snapshot.fileDiffs[0]?.hasContent === false, 'Opening cleared the cached metadata list');
  assertResource(fixture.container.textContent.includes('fixture.ts'), 'Cached file header was not rendered');
  assertResource(fixture.container.querySelector('[aria-busy="true"]'), 'Pending expanded preview did not show loading');
  assertResource(!fixture.container.querySelector('.monaco-editor'), 'Pending contents mounted Monaco');
  assertRowCounts(7, 3);
  fixture.root.render(React.createElement(Probe, { includeContent: true, selectedScope: 'staged' }));
  await pause(100);
  assertRowCounts(4, 1);
  fixture.root.render(React.createElement(Probe, { includeContent: true }));
  await pause(100);
  const fullReadsOnOpen = calls.filter(Boolean).length;
  const openingRefresh = controller.refresh({ forceRefresh: true, coalesceForcedRefresh: true, silent: true });
  releaseContent(firstWorkspace);
  await openingRefresh;
  await pause(100);
  assertResource(calls.filter(Boolean).length === fullReadsOnOpen, 'Panel-open refresh queued duplicate full read');
  assertResource(controller.snapshot.fileDiffs[0]?.hasContent === true, 'File contents did not hydrate');
  assertResource(fixture.container.querySelector('[aria-expanded="true"]'), 'Hydration lost expansion state');
  assertRowCounts(7, 3);
  fixture.root.render(React.createElement(Probe, { includeContent: false }));
  await pause(100);
  const fullReadsAfterClose = calls.filter(Boolean).length;
  notify({ workspacePath: firstWorkspace });
  await pause(200);
  assertResource(calls.filter(Boolean).length === fullReadsAfterClose, 'Closed watcher refresh loaded full content');
  fixture.root.render(React.createElement(Probe, { includeContent: true }));
  await pause(100);
  assertResource(controller.snapshot.fileDiffs[0]?.fileName === 'fixture.ts', 'Reopening hid the cached list');
  assertResource(controller.snapshot.fileDiffs[0]?.hasContent === false, 'Closing retained full contents');
  assertRowCounts(7, 3);
  assertResource(fixture.container.querySelector('[aria-expanded="true"]'), 'Reopening lost expansion state');
  fixture.root.render(React.createElement(Probe, { includeContent: true, workspacePath: secondWorkspace }));
  await pause(150);
  assertResource(controller.snapshot.fileDiffs[0]?.fileName === 'second.ts', 'Cold project list waited for full contents');
  assertResource(controller.snapshot.fileDiffs[0]?.hasContent === false, 'Cold metadata claimed to own contents');
  assertRowCounts(7, 3);
  releaseContent(firstWorkspace);
  await pause(100);
  assertResource(controller.snapshot.fileDiffs[0]?.fileName === 'second.ts', 'Late response replaced the selected project list');
  assertResource(renders.filter(render => render.workspacePath === secondWorkspace).every(render => !render.names.includes('fixture.ts')), 'Project switch briefly rendered the previous project list');
  releaseContent(secondWorkspace);
  await pause(100);
  assertResource(controller.snapshot.fileDiffs[0]?.hasContent === true, 'Cold project contents did not hydrate');
  fixture.close();
  return { closedCalls, fullReadsOnOpen, fullReadsAfterClose, totalCalls: calls.length,
    cachedListDuringBlockedRead: true, reopenListPreserved: true, coldListBeforeContents: true,
    pendingPreviewWithoutMonaco: true, expansionPreserved: true, projectIsolation: true,
    scopedCountsBeforeContents: true, scopeOnlyCountChange: true };

}
export async function exerciseDiffHeaderLayout() {
  await import('/src/index.css');
  await document.fonts.ready;
  const fixture = createFixtureRoot();
  Object.assign(fixture.container.style, { display: 'flex', flexDirection: 'column', height: '400px' });
  const noop = () => {};
  const asyncNoop = async () => {};
  const fileName = 'src/deep/path/a-very-long-module-filename-that-must-truncate-without-moving-counts.ts';
  const cases = [];
  function Probe({ count, scope, hydrated }) {
    const [expanded, setExpanded] = React.useState(new Set());
    const diffs = Array.from({ length: count }, (_, index) => ({
      fileName: index === 0 ? fileName : 'src/file-' + index + '.ts',
      hasContent: hydrated, contentSignature: hydrated ? 'layout-full' : 'status',
      addedLineCount: 12, removedLineCount: 3,
      isStaged: true, isUnstaged: true, isUntracked: false, isDeleted: false,
      oldContent: hydrated ? 'const oldValue = 1;\n' : null,
      newContent: hydrated ? 'const newValue = 2;\nconst another = 3;\n' : '',
    }));
    return React.createElement(VirtualizedConversationDiffFileList, {
      diffs, expandedFilePathSet: expanded, selectedScope: scope,
      onExpandedChange: (path, value) => setExpanded(current => {
        const next = new Set(current);
        if (value) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return next;
      }),
      onDiscardFile: asyncNoop, onPreloadDiff: asyncNoop, onStageFile: asyncNoop,
      onUnstageFile: asyncNoop, pendingFileActionPath: null, prewarmEnabled: false,
    });
  }
  function header() {
    return fixture.container.querySelector('[data-diff-file-header]');
  }
  function bounds() {
    const row = header();
    const elements = {
      header: row,
      name: row.querySelector('[aria-label="' + fileName + '"]'),
      icon: row.querySelector('svg'),
      added: row.querySelector('.text-git-added'),
      removed: row.querySelector('.text-git-removed'),
      action: row.querySelector('button[aria-label]'),
    };
    return Object.fromEntries(Object.entries(elements).map(([name, element]) => {
      assertResource(element, 'Missing header element: ' + name);
      const rect = element.getBoundingClientRect();
      return [name, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
    }));
  }
  function assertSameBounds(before, phase) {
    const after = bounds();
    let maxShift = 0;
    for (const name of Object.keys(before)) {
      for (const dimension of ['x', 'y', 'width', 'height']) {
        const shift = Math.abs(before[name][dimension] - after[name][dimension]);
        maxShift = Math.max(maxShift, shift);
        assertResource(shift <= 0.1, phase + ': ' + name + '.' + dimension + ' shifted by ' + shift + 'px');
      }
    }
    return maxShift;
  }
  try {
    for (const width of [850, 320]) {
      fixture.container.style.width = width + 'px';
      for (const scope of ['staged', 'unstaged']) {
        for (const count of [2, 30]) {
          const key = width + '-' + scope + '-' + count;
          const render = hydrated => fixture.root.render(React.createElement(Probe, { key, count, scope, hydrated }));
          render(false);
          await pause(100);
          await document.fonts.ready;
          await paintOpportunity();
          const before = bounds();
          assertResource(before.header.height === 52, 'Header did not reserve its exact height');
          const collapsedHeaders = fixture.container.querySelectorAll('[data-diff-file-header]');
          assertResource(Math.abs(collapsedHeaders[1].getBoundingClientRect().y - before.header.y - 53) <= 0.1, 'Collapsed row offsets do not match the actual row height: ' + JSON.stringify({ key, step: collapsedHeaders[1].getBoundingClientRect().y - before.header.y, header: before.header, rowHeight: header().parentElement.getBoundingClientRect().height, border: getComputedStyle(header().parentElement).borderBottomWidth }));
          header().querySelector('button[aria-expanded]').click();
          await paintOpportunity();
          const loadingShift = assertSameBounds(before, 'expanded pending ' + key);
          assertResource(fixture.container.querySelector('[aria-busy="true"]'), 'Expanded loading body missing');
          render(true);
          for (let attempt = 0; attempt < 100 && !fixture.container.querySelector('.monaco-editor'); attempt++) {
            await pause(50);
          }
          assertResource(fixture.container.querySelector('.monaco-editor'), 'Hydrated preview did not mount');
          await pause(100);
          await paintOpportunity();
          const loadedShift = assertSameBounds(before, 'hydrated ' + key);
          header().querySelector('button[aria-expanded]').click();
          await paintOpportunity();
          const collapsedShift = assertSameBounds(before, 'collapsed ' + key);
          const headers = fixture.container.querySelectorAll('[data-diff-file-header]');
          assertResource(Math.abs(headers[1].getBoundingClientRect().y - before.header.y - 53) <= 0.1, 'Collapse retained an expanded row offset');
          header().querySelector('button[aria-expanded]').click();
          await paintOpportunity();
          const reopenedShift = assertSameBounds(before, 'reopened ' + key);
          cases.push({ width, scope, count, loadingShift, loadedShift, collapsedShift, reopenedShift });
        }
      }
    }
  } finally {
    fixture.close();
  }
  return { cases, maxShiftPx: Math.max(...cases.flatMap(result => [result.loadingShift, result.loadedShift, result.collapsedShift, result.reopenedShift])) };
}
export async function exerciseStartupDemand() {
  const fixture = createFixtureRoot();
  let requests = 0;
  let loaded = false;
  window.tidecodeGit = {
    getStatus: async () => { requests++; return { hasRepository: false }; },
    getBranches: async () => { requests++; return { hasRepository: false }; },
  };
  window.tidecodeHistory = {
    listConversations: async () => Array.from({ length: 10 }, (_, index) => ({ id: 'saved-' + index, agentContextRootPath: 'C:/inactive-' + index })),
    listFolders: async () => Array.from({ length: 10 }, (_, index) => ({ id: 'folder-' + index, path: 'C:/inactive-' + index })),
    ensureDraftAgentContext: async () => {},
  };
  const initializeHistory = () => { loaded = true; };
  const noop = () => {};
  function Probe() {
    useInitializeChatHistory({ enabled: true, initializeHistory, preferredDraftFolderId: null, preferredConversationId: null, openEmptyConversationOnLaunch: true, setError: noop, setIsLoading: noop });
    return null;
  }
  fixture.root.render(React.createElement(Probe));
  await pause(6000);
  fixture.close();
  assertResource(loaded && requests === 0, 'Startup prefetched inactive saved repositories');
  return { savedProjects: 10, inactiveGitRequests: requests };
}
export async function exerciseToolLifecycle() {
  window.__resourceStage = 'tool-collapsed';
  const fixture = createFixtureRoot();
  fixture.root.render(React.createElement(ToolInvocationBlock, { invocation: {
    id: 'fixture-tool', toolName: 'patch', state: 'completed', startedAt: 1, completedAt: 2,
    argumentsText: '{}', resultContent: 'Updated fixture',
    resultPresentation: { kind: 'file_diff', fileName: 'fixture.ts', oldContent: 'const value = 1', newContent: 'const value = 2' },
  } }));
  await pause(300);
  assertResource(fixture.container.querySelectorAll('.monaco-editor').length === 0, 'Collapsed tool created editors');
  fixture.container.querySelector('button').click();
  window.__resourceStage = 'tool-runtime';
  const monaco = await preloadWorkspaceMonacoRuntime();
  window.__resourceStage = 'tool-mount';
  for (let attempt = 0; attempt < 100 && !fixture.container.querySelector('.monaco-editor'); attempt++) {
    await pause(100);
  }
  assertResource(fixture.container.querySelector('.monaco-editor'), 'Expanded tool failed to mount an editor');
  const modelCounts = [];
  window.__resourceStage = 'tool-cycles';
  for (let index = 0; index < 20; index++) {
    fixture.container.querySelector('button').click();
    await pause(100);
    assertResource(!fixture.container.querySelector('.monaco-editor'), 'Collapsed tool retained its editor');
    fixture.container.querySelector('button').click();
    await pause(150);
    modelCounts.push(monaco.editor.getModels().length);
  }
  fixture.close();
  window.__resourceStage = 'tool-model-release';
  await pause(31000);
  const remainingModels = monaco.editor.getModels().length;
  assertResource(remainingModels === 0, 'Closed tool models did not expire');
  assertResource(Math.max(...modelCounts) <= 2, 'Repeated tool opening accumulated models');
  return { cycles: 20, modelCounts, remainingModels };
}
export async function exerciseSendLatency() {
  const fixture = createFixtureRoot();
  const samples = [];
  const noop = () => {};
  for (let index = 0; index < 10; index++) {
    let saved = { id: 'latency-' + index, folderId: null, agentContextRootPath: 'C:/synthetic', chatMode: 'agent', messages: [], createdAt: 1, updatedAt: 1, title: 'Fixture' };
    const runtime = { current: { [saved.id]: { conversation: saved, activeStreamId: null } } };
    const active = { current: saved.id };
    let composerRevision = 0;
    let releaseCheckpoint;
    const blocked = new Promise(resolve => { releaseCheckpoint = resolve; });
    window.tidecodeHistory = {
      getConversation: async () => saved,
      appendMessages: async ({ messages }) => { saved = { ...saved, messages: [...saved.messages, ...messages] }; return saved; },
      replaceMessages: async ({ messages }) => { saved = { ...saved, messages }; return saved; },
    };
    window.tidecodeWorkspace = { createCheckpoint: async () => { await blocked; return { id: 'checkpoint', createdAt: 1 }; } };
    window.tidecodeTerminal = { getEnvironmentSnapshot: async () => null };
    const redraw = () => fixture.root.render(React.createElement('div', null, runtime.current[saved.id].conversation.messages.map(message => React.createElement('div', { key: message.id, 'data-message-id': message.id }, message.content))));
    const upsert = conversation => { runtime.current[conversation.id] = { conversation, activeStreamId: null }; redraw(); };
    let pending;
    const submit = () => { pending = persistAndStreamMessage({
      activeConversationId: saved.id, activeConversationIdRef: active, selectedFolderId: null, selectedFolderIdRef: { current: null },
      conversationRuntimeStatesRef: runtime, attachments: [], draftChatMode: 'agent', originalText: 'Immediate message', trimmedText: 'Immediate message', targetEditMessageId: null,
      runtimeSelection: { hasConfiguredProvider: true, providerId: 'codex', providerLabel: 'Fixture', modelId: 'fixture', reasoningEffort: 'low', terminalExecutionMode: 'auto' },
      syntheticAssistantMessage: { id: 'synthetic-reply', role: 'assistant', content: 'Synthetic', timestamp: 2 },
      applyConversation: upsert, upsertConversation: upsert,
      replaceLocalMessages: (id, messages) => upsert({ ...runtime.current[id].conversation, messages }),
      updateConversationRuntimeState: noop, updateConversationSummary: noop, clearError: noop, clearTextStreamingIdleTimeout: noop,
      appendLocalMessage: noop, removeLocalMessage: noop, updateLocalMessage: noop, completeEditingMessage: noop, markTextStreamingPulse: noop, stopTextStreaming: noop,
      getMainComposerRevision: () => composerRevision, setMainComposerValue: () => { composerRevision++; }, setMainComposerAttachments: noop, setMainComposerMentionPathMap: noop,
      setPendingDraftSendCount: noop, setOptimisticDraftMessages: noop, consumePendingAbortBeforeStreamStart: () => false, hasPendingAbortRequest: () => false,
      setError: error => { throw new Error(error); },
    }); };
    fixture.root.render(React.createElement('button', { onClick: submit }, 'Send'));
    for (let attempt = 0; attempt < 100 && !fixture.container.querySelector('button'); attempt++) {
      await pause(10);
    }
    const started = performance.now();
    fixture.container.querySelector('button').click();
    await paintOpportunity();
    assertResource(fixture.container.querySelector('[data-message-id]')?.textContent === 'Immediate message', 'Bubble missing while checkpoint blocked: ' + fixture.container.innerHTML);
    assertResource(saved.messages.length === 0, 'Checkpoint fixture did not block saving');
    samples.push(performance.now() - started);
    releaseCheckpoint();
    assertResource(await pending, 'Synthetic send failed');
    await paintOpportunity();
    assertResource(fixture.container.querySelectorAll('[data-message-id]').length === 2, 'Send reconciliation duplicated the bubble');
  }
  fixture.close();
  const ordered = [...samples].sort((a, b) => a - b);
  return { samples, medianMs: ordered[5], p95Ms: ordered[9], note: 'DOM visibility checked after two animation frames; synthetic persistence held, no provider traffic.' };
}
`;

if (!process.versions.electron) {
  const root = path.resolve(option('--root', workspace))
  const mode = option('--mode', 'built')
  if (!['built', 'dev'].includes(mode)) {
    throw new Error('--mode must be built or dev')
  }
  if ((args.includes('--resources') || args.includes('--interactions')) && mode !== 'dev') {
    throw new Error('--resources requires --mode dev to exercise source components')
  }
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'tidecode-memory-profile-'))
  const home = path.join(fixture, 'home')
  const appData = path.join(fixture, 'app-data')
  const history = path.join(home, '.tidecode', 'history')
  await mkdir(history, { recursive: true })
  await mkdir(appData, { recursive: true })
  await writeFile(path.join(fixture, 'pdf-data-url.txt'), createPdfFixture())
  const historyMiB = Number(option('--history-mib', '32'))
  if (!Number.isFinite(historyMiB) || historyMiB < 0 || historyMiB > 256) {
    throw new Error('--history-mib must be between 0 and 256')
  }
  const workspaceFixturePath = args.includes('--git-fixture') ? path.join(home, 'workspace') : home
  if (args.includes('--git-fixture')) {
    await mkdir(workspaceFixturePath, { recursive: true })
    const git = (...gitArgs) => execFileAsync('git', gitArgs, { cwd: workspaceFixturePath, windowsHide: true })
    await git('init', '--quiet')
    const source = Array.from({ length: 500 }, (_, index) => 'export const value' + index + ' = ' + index).join('\n')
    for (let index = 0; index < 50; index += 1) {
      await writeFile(path.join(workspaceFixturePath, 'file-' + index + '.ts'), source)
    }
    await git('add', '.')
    await git('-c', 'user.name=Profiler', '-c', 'user.email=profiler@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Synthetic fixture')
    for (let index = 0; index < 50; index += 1) {
      await writeFile(path.join(workspaceFixturePath, 'file-' + index + '.ts'), source + '\n// changed')
    }
  }
  const content = 'Synthetic profiling transcript.\n'.repeat(Math.ceil(historyMiB * 1024 * 1024 / 32 / 32))
  for (let index = 0; index < 32; index += 1) {
    await writeFile(path.join(history, `profile-${index}.json`), JSON.stringify({
      agentContextRootPath: workspaceFixturePath, chatMode: 'agent', createdAt: index + 1,
      folderId: null, id: `profile-${index}`, title: `Memory fixture ${index}`,
      updatedAt: index + 1,
      messages: [{ content, id: `message-${index}`, role: 'user', timestamp: index + 1, reasoningEffort: 'minimal' }],
    }))
  }
  if (root !== workspace) {
    try {
      await access(path.join(root, 'node_modules'))
    } catch {
      await symlink(path.join(workspace, 'node_modules'), path.join(root, 'node_modules'), 'junction')
    }
  }
  let server
  let devUrl = ''
  if (mode === 'dev') {
    const [{ createServer }, { default: react }, { default: tailwindcss }] = await Promise.all([
      import('vite'), import('@vitejs/plugin-react'), import('@tailwindcss/vite'),
    ])
    server = await createServer({
      root, configFile: false, plugins: [react(), tailwindcss(), {
        name: 'tidecode-memory-scenario',
        resolveId: (id) => id === '/__memory-profile' ? '\0memory-profile' : undefined,
        load: (id) => id === '\0memory-profile' ? resourceScenarioModule + interactionScenarioModule : undefined,
        configureServer(server) {
          server.middlewares.use('/__resource-harness.html', async (_request, response, next) => {
            try {
              const html = await server.transformIndexHtml('/__resource-harness.html', '<!doctype html><html><body></body></html>');
              response.setHeader('Content-Type', 'text/html');
              response.end(html);
            } catch (error) {
              next(error);
            }
          });
        },
      }],
      resolve: { alias: [{
        find: /^monaco-editor\/esm\/vs\/language\/typescript\/ts\.worker(?:\.js)?$/,
        replacement: path.join(root, 'src/components/workspaceExplorer/workspaceFileEditor/workspaceTypeScript.worker.js'),
      }] },
      server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/dist*/**', '**/release/**', '**/build/**'] } },
    })
    await server.listen()
    devUrl = server.resolvedUrls.local[0]
  }
  const env = {
    ...process.env, USERPROFILE: home, HOME: home,
    TIDECODE_RUN_SERVICE_NAMESPACE: `profile-${path.basename(fixture).slice(-6)}`,
    TIDECODE_RUN_SERVICE_ENTRY: path.join(root, 'dist-cli-runtime/run-service.mjs'),
    TIDECODE_RUN_SERVICE_RUNTIME_ROOT: path.join(root, 'dist-cli-runtime'),
  }
  const portProbe = net.createServer()
  await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
  env.TIDECODE_REMOTE_PORT = String(portProbe.address().port)
  await new Promise((resolve) => portProbe.close(resolve))
  delete env.ELECTRON_RUN_AS_NODE
  delete env.TIDECODE_SETTINGS_HOME
  delete env.VITE_DEV_SERVER_URL
  if (devUrl) {
    env.VITE_DEV_SERVER_URL = devUrl
  }
  const child = spawn(require('electron'), [fileURLToPath(import.meta.url), '--electron',
    '--root', root, '--fixture', fixture, '--mode', mode,
    '--seconds', option('--seconds', '40'),
    '--recovery-seconds', option('--recovery-seconds', '30'),
    ...(args.includes('--resources') ? ['--resources'] : []),
    ...(args.includes('--interactions') ? ['--interactions'] : []),
    ...(option('--interaction-scenario') ? ['--interaction-scenario', option('--interaction-scenario')] : []),
  ], { env, windowsHide: true, stdio: 'inherit' })
  const driverSamples = []
  const driverTimer = setInterval(() => {
    driverSamples.push({ elapsedMs: Date.now(), ...process.memoryUsage() })
  }, 2_000)
  child.on('error', (error) => { console.error(error); process.exitCode = 1 })
  const code = await new Promise((resolve) => child.on('exit', resolve))
  clearInterval(driverTimer)
  const reportPath = path.join(fixture, 'report.json')
  let scenarioFailed = false
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    scenarioFailed = report.failures.length > 0
    report.driverSamples = driverSamples
    report.driverNote = mode === 'dev' ? 'The driver hosts Vite; its RSS is separate from Electron app memory.' : 'The driver is profiling overhead and is separate from Electron app memory.'
    await writeFile(reportPath, JSON.stringify(report, null, 2))
  } catch (error) {
    scenarioFailed = true
    console.error('Unable to append profiling driver measurements', error)
  }
  await server?.close()
  process.exitCode = scenarioFailed ? 1 : code ?? 1
} else {
  // Electron waits for its entry module to finish before firing ready. Keep the
  // asynchronous scenario outside top-level await to avoid blocking that event.
  void (async () => {
  console.log('Starting isolated Electron memory profile')
  const { app, BrowserWindow, webContents, ipcMain } = await import('electron')
  const gitRequests = { content: 0, status: 0, branches: 0, commitStatus: 0 }
  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) => originalHandle(channel, (event, ...params) => {
    if (channel === 'git:getDiffs') {
      gitRequests[params[0]?.options?.includeContent === false ? 'status' : 'content'] += 1
    }
    if (channel === 'git:getBranches') {
      gitRequests.branches += 1
    }
    if (channel === 'git:getStatus') {
      gitRequests.commitStatus += 1
    }
    return listener(event, ...params)
  })
  app.commandLine.appendSwitch('enable-precise-memory-info')
  const fixture = option('--fixture')
  const root = option('--root')
  app.setName(`TideCode memory profile ${path.basename(fixture).slice(-6)}`)
  app.setPath('home', path.join(fixture, 'home'))
  app.setPath('appData', path.join(fixture, 'app-data'))
  app.setPath('userData', path.join(fixture, 'app-data', 'profile'))
  const samples = []
  const failures = []
  const resourceChecks = []
  const startedAt = Date.now()
  async function sample(phase) {
    const processes = app.getAppMetrics().map(({ pid, type, memory, cpu }) => ({ pid, type, cpu, ...memory }))
    const renderers = []
    const contentsOwnership = webContents.getAllWebContents().filter(contents => !contents.isDestroyed()).map(contents => ({
      id: contents.id,
      pid: contents.getOSProcessId(),
      type: contents.getType(),
      hostId: contents.hostWebContents?.id ?? null,
      visible: BrowserWindow.fromWebContents(contents)?.isVisible() ?? null,
    }))
    for (const contents of webContents.getAllWebContents()) {
      if (contents.getType() !== 'window' || contents.isDestroyed()) {
        continue
      }
      try {
        const renderer = await contents.executeJavaScript(`({
          heapBytes: performance.memory?.usedJSHeapSize ?? null,
          domNodes: document.getElementsByTagName('*').length,
          canvasPixels: Array.from(document.querySelectorAll('canvas')).reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
          pdf: (() => {
            const viewport = document.querySelector('.workspace-pdf-preview .overflow-auto');
            return viewport ? {
              height: viewport.clientHeight, width: viewport.clientWidth,
              canvases: Array.from(viewport.querySelectorAll('canvas')).map(canvas => ({ width: canvas.width, height: canvas.height, top: canvas.getBoundingClientRect().top })),
              text: viewport.textContent.slice(0, 300),
            } : null;
          })(),
        })`)
        if (!contents.debugger.isAttached()) {
          contents.debugger.attach('1.3')
        }
        const { targetInfos } = await contents.debugger.sendCommand('Target.getTargets')
        const workerCount = targetInfos.filter((target) => ['worker', 'shared_worker', 'service_worker'].includes(target.type)).length
        renderers.push({ pid: contents.getOSProcessId(), workerCount, ...renderer })
      } catch {
        // A window can close between enumeration and sampling.
      }
    }
    const value = { phase, elapsedMs: Date.now() - startedAt, processes, contentsOwnership, gitRequests: { ...gitRequests }, renderers, main: process.memoryUsage() }
    samples.push(value)
    console.log(JSON.stringify(value))
    return value
  }
  try {
    console.log('Loading built application')
    await import(pathToFileURL(path.join(root, 'dist-electron/main.js')).href)
    console.log('Waiting for application ready')
    await app.whenReady()
    let mainWindow
    for (let attempt = 0; attempt < 100; attempt += 1) {
      mainWindow = BrowserWindow.getAllWindows().find((window) => window.getBounds().width > 500)
      if (mainWindow && !mainWindow.webContents.isLoading()) {
        break
      }
      await wait(200)
    }
    if (!mainWindow) {
      throw new Error('The application window did not start')
    }
    await wait(5_000)
    const seconds = Number(option('--seconds', '40'))
    await sample('startup')
    for (let index = 0; index < Math.ceil(seconds / 2); index += 1) {
      await wait(2_000)
      await sample('idle')
    }
    for (let index = 0; index < 3; index += 1) {
      await mainWindow.webContents.executeJavaScript('window.tidecodeHistory.listConversations().then(result => result.length)')
      await sample('history-list')
    }
    for (let index = 0; index < 12; index += 1) {
      const clicked = await mainWindow.webContents.executeJavaScript(`(() => {
        const target = Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Memory fixture ${index}'));
        target?.click(); return Boolean(target);
      })()`)
      if (!clicked) {
        failures.push(`Chat fixture ${index} was not found in the visible sidebar`)
        break
      }
      await wait(500)
      await sample('chat-switch')
    }
    for (let index = 0; index < Math.ceil(Number(option('--recovery-seconds', '30')) / 2); index += 1) {
      await wait(2_000)
      await sample('recovery')
    }
    if ((args.includes('--resources') || args.includes('--interactions')) && option('--mode') === 'dev') {
      if (args.includes('--resources')) {
      const contents = mainWindow.webContents
      const dataUrl = await readFile(path.join(fixture, 'pdf-data-url.txt'), 'utf8')
      for (let index = 0; index < 3; index += 1) {
        await contents.executeJavaScript(`import('/__memory-profile').then(module => module.mountPdf(${JSON.stringify(dataUrl)}))`)
        await wait(3_000)
        const open = await sample('pdf-open')
        const pdfRenderer = open.renderers.find((renderer) => renderer.pdf)
        if (!pdfRenderer || pdfRenderer.canvasPixels === 0 || pdfRenderer.canvasPixels > 12 * 1024 * 1024) {
          failures.push('PDF viewport rendering did not produce a bounded visible canvas')
        }
        await contents.executeJavaScript("import('/__memory-profile').then(module => module.scrollPdf())")
        await wait(1_000)
        await sample('pdf-scroll')
        await contents.executeJavaScript("import('/__memory-profile').then(module => module.unmountPdf())")
        await wait(2_000)
        const closed = await sample('pdf-close')
        resourceChecks.push({ phase: 'pdf-release', iteration: index, workerCounts: closed.renderers.map((renderer) => renderer.workerCount) })
        if (closed.renderers.some((renderer) => renderer.pdf || renderer.canvasPixels > 0 || renderer.workerCount > 0)) {
          failures.push('PDF close left a canvas or worker alive')
        }
      }
      const monaco = await contents.executeJavaScript("import('/__memory-profile').then(module => module.exerciseMonaco())")
      console.log(JSON.stringify({ phase: 'monaco-languages', ...monaco }))
      resourceChecks.push({ phase: 'monaco-languages', ...monaco })
      if (monaco.languages.includes('python') || !monaco.languages.includes('typescript')) {
        failures.push('Monaco language grammars were not loaded on demand')
      }
      if (!monaco.themePreserved) {
        failures.push('Chat highlighting changed Monaco syntax token colors')
      }
      await sample('monaco-close')
      }
      const harness = new BrowserWindow({ width: 900, height: 700, title: 'TideCode isolated UX profile', webPreferences: { contextIsolation: false, backgroundThrottling: false } })
      try {
        await harness.loadURL(new URL('/__resource-harness.html', process.env.VITE_DEV_SERVER_URL).href)
        const scenarios = ['exerciseSendLatency', 'exerciseDemandLifecycle', 'exerciseStartupDemand', 'exerciseToolLifecycle', 'exerciseDiffHeaderLayout']
        const selectedScenario = option('--interaction-scenario')
        if (selectedScenario && !scenarios.includes(selectedScenario)) {
          throw new Error('Unknown interaction scenario: ' + selectedScenario)
        }
        for (const scenario of selectedScenario ? [selectedScenario] : scenarios) {
          let stage = scenario
          const progressTimer = setInterval(() => {
            void harness.webContents.executeJavaScript('window.__resourceStage').then(value => {
              stage = value ?? scenario
            }).catch(() => undefined)
          }, 5_000)
          let timeout
          let result
          try {
            result = await Promise.race([
              harness.webContents.executeJavaScript("import('/__memory-profile').then(module => module." + scenario + "())"),
              new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('Scenario timed out: ' + stage)), 90_000)
              }),
            ])
          } finally {
            clearTimeout(timeout)
            clearInterval(progressTimer)
          }
          resourceChecks.push({ phase: scenario, ...result })
          console.log(JSON.stringify({ phase: scenario, ...result }))
        }
        // Allow models from the final interaction scenario to expire before
        // sampling recovery, without forcing GC.
        await wait(30_000)
        await sample('interaction-recovery')
      } finally {
        harness.destroy()
      }

    }
  } catch (error) {
    failures.push(error.stack ?? String(error))
    process.exitCode = 1
  } finally {
    const report = { mode: option('--mode'), root, fixture, samples, failures, resourceChecks,
      note: 'Electron child process metrics are KiB; JS heap and main process memory are bytes. Built mode uses the built renderer in an unpackaged isolated Electron host. No forced GC.' }
    await writeFile(path.join(fixture, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`Memory report: ${path.join(fixture, 'report.json')}`)
    // This scenario only reads history and selects chats. It never starts an AI
    // run or terminal, so no detached profiling service needs to be shut down.
    app.quit()
  }
  })().catch((error) => { console.error(error); process.exit(1) })
}
