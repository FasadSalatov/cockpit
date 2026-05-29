import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import type {
  HostToWebview,
  WebviewToHost,
  PermissionDetail,
  SessionEntry,
  HistoryMsg,
  Settings,
  ImageAttachment,
  PromptTemplate,
} from './protocol'
import { DEFAULT_SETTINGS } from './protocol'
import { runPrompt } from './agent'
import { BridgeHost } from './bridge-host'

const TOKEN_KEY = 'cockpit.oauthToken'
const THEME_KEY = 'cockpit.theme'
const MODEL_KEY = 'cockpit.model'
const COST_TOTAL_KEY = 'cockpit.costTotal'
const COST_TODAY_KEY = 'cockpit.costToday'
const COST_TODAY_DATE_KEY = 'cockpit.costTodayDate'
const SETTINGS_KEY = 'cockpit.settings'
const ACH_KEY = 'cockpit.achievements'
const STATS_KEY = 'cockpit.stats'

interface DayStats {
  date: string
  prompts: number
  edits: number
  forks: number
}

const ACHIEVEMENTS: { id: string; emoji: string; label: string; check: (s: DayStats) => boolean }[] = [
  { id: 'first_session', emoji: '🚀', label: 'Первый запрос в Cockpit', check: (s) => s.prompts >= 1 },
  { id: 'ten_prompts_day', emoji: '🔥', label: '10 запросов за день', check: (s) => s.prompts >= 10 },
  { id: 'fifty_prompts_day', emoji: '🌋', label: '50 запросов за день', check: (s) => s.prompts >= 50 },
  { id: 'first_edit_approved', emoji: '✏️', label: 'Первая принятая правка', check: (s) => s.edits >= 1 },
  { id: 'fifty_edits_day', emoji: '🛠️', label: '50 правок за день', check: (s) => s.edits >= 50 },
  { id: 'first_fork', emoji: '🌿', label: 'Первый форк сессии', check: (s) => s.forks >= 1 },
]

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function getStats(ctx: vscode.ExtensionContext): DayStats {
  const s = ctx.globalState.get<DayStats>(STATS_KEY)
  if (!s || s.date !== todayISO()) return { date: todayISO(), prompts: 0, edits: 0, forks: 0 }
  return s
}
async function bumpStat(ctx: vscode.ExtensionContext, key: 'prompts' | 'edits' | 'forks') {
  const s = getStats(ctx)
  s[key]++
  await ctx.globalState.update(STATS_KEY, s)
  await checkAchievements(ctx, s)
}
async function checkAchievements(ctx: vscode.ExtensionContext, s: DayStats) {
  const done = new Set(ctx.globalState.get<string[]>(ACH_KEY) ?? [])
  for (const a of ACHIEVEMENTS) {
    if (!done.has(a.id) && a.check(s)) {
      done.add(a.id)
      postToAll({ type: 'achievement', payload: { id: a.id, label: a.label, emoji: a.emoji } })
    }
  }
  // night owl — отдельно по часу
  if (!done.has('night_owl')) {
    const h = new Date().getHours()
    if (h >= 22 || h < 6) {
      done.add('night_owl')
      postToAll({
        type: 'achievement',
        payload: { id: 'night_owl', label: 'Ночная сова', emoji: '🦉' },
      })
    }
  }
  await ctx.globalState.update(ACH_KEY, [...done])
}

function getSettings(context: vscode.ExtensionContext): Settings {
  const stored = context.globalState.get<Partial<Settings>>(SETTINGS_KEY) ?? {}
  return { ...DEFAULT_SETTINGS, ...stored }
}

let panel: vscode.WebviewPanel | undefined
let settingsPanel: vscode.WebviewPanel | undefined
let sidebarView: vscode.WebviewView | undefined
let sessionId: string | undefined
let bridge: BridgeHost | undefined
let busy = false
let currentInterrupt: (() => void) | undefined
let statusItem: vscode.StatusBarItem | undefined
let sessionCostUsd = 0
let sessionInputTokens = 0
let sessionOutputTokens = 0
let sessionCacheReadTokens = 0
const subscriptionLimits = new Map<string, import('./protocol').RateLimitInfo>()

const pendingPermissions = new Map<string, (approved: boolean) => void>()
const previewContents = new Map<string, string>()
const previewProvider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri) {
    const params = new URLSearchParams(uri.query)
    const id = params.get('id') ?? ''
    return previewContents.get(id) ?? ''
  },
}

function previewUri(id: string, file: string) {
  return vscode.Uri.parse(`cockpit-preview:${encodeURI(file)}?id=${id}`)
}

async function buildPreviewContent(detail: PermissionDetail): Promise<string> {
  if (detail.kind === 'write') return detail.content
  if (detail.kind === 'edit') {
    try {
      const data = fs.readFileSync(detail.file, 'utf8')
      const idx = data.indexOf(detail.oldText)
      if (idx < 0) return data
      return data.slice(0, idx) + detail.newText + data.slice(idx + detail.oldText.length)
    } catch {
      return detail.newText
    }
  }
  return ''
}

async function openPermissionDiff(id: string, detail: PermissionDetail) {
  if (detail.kind !== 'edit' && detail.kind !== 'write') return
  if (!detail.file) return
  try {
    const preview = await buildPreviewContent(detail)
    previewContents.set(id, preview)
    const left = vscode.Uri.file(detail.file)
    const right = previewUri(id, detail.file)
    const name = path.basename(detail.file)
    const title =
      detail.kind === 'write' ? `Cockpit · создать ${name}` : `Cockpit · правка ${name}`
    await vscode.commands.executeCommand('vscode.diff', left, right, title, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    })
  } catch (e) {
    console.error('[cockpit] openPermissionDiff:', e)
  }
}

function closePermissionDiff(id: string) {
  previewContents.delete(id)
  const uri = previewUri(id, '')
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { modified?: vscode.Uri } | undefined
      const mod = input?.modified
      if (mod && mod.scheme === 'cockpit-preview' && mod.query.includes(`id=${id}`)) {
        void vscode.window.tabGroups.close(tab)
      }
    }
  }
  void uri
}

function toDetail(tool: string, input: Record<string, unknown>): PermissionDetail {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  if (tool === 'Edit' || tool === 'MultiEdit') {
    return {
      kind: 'edit',
      file: s(input.file_path),
      oldText: s(input.old_string),
      newText: s(input.new_string),
    }
  }
  if (tool === 'Write') {
    return { kind: 'write', file: s(input.file_path), content: s(input.content) }
  }
  if (tool === 'Bash') {
    return { kind: 'bash', command: s(input.command), description: s(input.description) }
  }
  return { kind: 'other', tool, input }
}

function requestPermission(tool: string, input: Record<string, unknown>): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const detail = toDetail(tool, input)
    pendingPermissions.set(id, resolve)
    postToMain({ type: 'permission', payload: { id, detail } })
    void openPermissionDiff(id, detail)
  })
}

function postToMain(msg: HostToWebview) {
  panel?.webview.postMessage(msg)
  bridge?.observeHostToWebview(msg, sessionId)
}
function postToSidebar(msg: HostToWebview) {
  sidebarView?.webview.postMessage(msg)
}
function postToSettings(msg: HostToWebview) {
  settingsPanel?.webview.postMessage(msg)
}
function postToAll(msg: HostToWebview) {
  postToMain(msg)
  postToSidebar(msg)
  postToSettings(msg)
}

// ---------- metrics ----------
function todayKey() {
  return new Date().toISOString().slice(0, 10)
}
function getCost(context: vscode.ExtensionContext) {
  const total = context.globalState.get<number>(COST_TOTAL_KEY) ?? 0
  const savedDate = context.globalState.get<string>(COST_TODAY_DATE_KEY)
  const today = savedDate === todayKey() ? (context.globalState.get<number>(COST_TODAY_KEY) ?? 0) : 0
  return { today, total }
}
async function addCost(context: vscode.ExtensionContext, delta: number) {
  if (!delta || !isFinite(delta)) return
  const { today, total } = getCost(context)
  const newToday = today + delta
  const newTotal = total + delta
  await context.globalState.update(COST_TODAY_KEY, newToday)
  await context.globalState.update(COST_TODAY_DATE_KEY, todayKey())
  await context.globalState.update(COST_TOTAL_KEY, newTotal)
  if (statusItem) statusItem.text = `🦈 Cockpit · $${newToday.toFixed(2)}`
  postToAll({ type: 'cost', payload: { today: newToday, total: newTotal } })
}

// ---------- activation ----------
export function activate(context: vscode.ExtensionContext) {
  const open = vscode.commands.registerCommand('cockpit.open', () => openPanel(context))

  const autoImportToken = vscode.commands.registerCommand('cockpit.autoImportToken', async () => {
    const platform = process.platform
    let token: string | undefined
    const { execFile } = require('node:child_process') as typeof import('node:child_process')
    const tryRun = (cmd: string, args: string[]): Promise<string | undefined> =>
      new Promise((resolve) => {
        execFile(cmd, args, { timeout: 15000 }, (err: any, stdout: string) => {
          if (err) resolve(undefined)
          else resolve(stdout)
        })
      })

    try {
      if (platform === 'darwin') {
        // macOS: системный диалог «Allow» появится при первом использовании
        const raw = await tryRun('security', [
          'find-generic-password',
          '-s',
          'Claude Code-credentials',
          '-w',
        ])
        if (raw) {
          // Может быть JSON {accessToken,...} или просто строкой
          try {
            const parsed = JSON.parse(raw)
            token =
              parsed?.claudeAiOauth?.accessToken ??
              parsed?.accessToken ??
              parsed?.token ??
              undefined
          } catch {
            token = raw.trim()
          }
        }
      } else if (platform === 'linux') {
        const raw = await tryRun('secret-tool', [
          'lookup',
          'service',
          'Claude Code-credentials',
        ])
        if (raw) token = raw.trim()
      } else if (platform === 'win32') {
        const ps = `(Get-StoredCredential -Target 'Claude Code-credentials').Password | ConvertFrom-SecureString -AsPlainText`
        const raw = await tryRun('powershell', ['-NoProfile', '-Command', ps])
        if (raw) token = raw.trim()
      }

      if (!token || !token.startsWith('sk-ant-oat')) {
        vscode.window
          .showWarningMessage(
            'Cockpit: не нашёл OAuth-токен в системе. Установи Claude CLI и выполни `claude setup-token`.',
            'Открыть инструкцию'
          )
          .then((pick) => {
            if (pick === 'Открыть инструкцию') {
              vscode.env.openExternal(vscode.Uri.parse('https://unyly.org/cockpit'))
            }
          })
        return
      }

      await context.secrets.store(TOKEN_KEY, token)
      postToAll({ type: 'tokenChanged', payload: { hasToken: true } })
      vscode.window.showInformationMessage(
        `🦈 Cockpit: токен подхвачен из ${platform === 'darwin' ? 'macOS Keychain' : platform === 'linux' ? 'libsecret' : 'Credential Manager'}`
      )
    } catch (e) {
      vscode.window.showErrorMessage(
        `Cockpit: не удалось импортировать токен — ${e instanceof Error ? e.message : String(e)}`
      )
    }
  })

  const setToken = vscode.commands.registerCommand('cockpit.setToken', async () => {
    const token = await vscode.window.showInputBox({
      title: 'Cockpit — токен подписки',
      prompt: 'Вставь CLAUDE_CODE_OAUTH_TOKEN (получить: claude setup-token)',
      password: true,
      ignoreFocusOut: true,
    })
    if (token === undefined) return
    if (token.trim() === '') await context.secrets.delete(TOKEN_KEY)
    else await context.secrets.store(TOKEN_KEY, token.trim())
    const hasToken = Boolean(token.trim())
    postToAll({ type: 'tokenChanged', payload: { hasToken } })
    vscode.window.showInformationMessage(
      hasToken ? 'Cockpit: токен сохранён' : 'Cockpit: токен удалён'
    )
  })

  // Контекстное меню «Спросить Cockpit о выделении».
  const askSelection = vscode.commands.registerCommand('cockpit.askAboutSelection', async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const sel = editor.selection
    const text = editor.document.getText(sel)
    if (!text.trim()) {
      vscode.window.showInformationMessage('Cockpit: выдели фрагмент кода.')
      return
    }
    const rel = vscode.workspace.asRelativePath(editor.document.uri)
    const lang = editor.document.languageId
    const prefill =
      `Объясни этот код из \`${rel}\` (строки ${sel.start.line + 1}–${sel.end.line + 1}):\n\n` +
      '```' +
      lang +
      '\n' +
      text +
      '\n```'
    await openPanel(context)
    postToMain({ type: 'prefill', payload: { text: prefill } })
  })

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  const initial = getCost(context)
  statusItem.text = `🦈 Cockpit · $${initial.today.toFixed(2)}`
  statusItem.tooltip = 'Открыть Cockpit'
  statusItem.command = 'cockpit.open'
  statusItem.show()

  const sidebarProvider: vscode.WebviewViewProvider = {
    resolveWebviewView(view) {
      sidebarView = view
      view.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
      }
      view.webview.html = getHtml(view.webview, context.extensionUri, 'sidebar')
      view.webview.onDidReceiveMessage(
        (msg: WebviewToHost) => handleMessage(context, msg, 'sidebar'),
        undefined,
        context.subscriptions
      )
      view.onDidDispose(() => (sidebarView = undefined))
    },
  }
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('cockpit.history', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  )

  const askAboutSymbol = vscode.commands.registerCommand(
    'cockpit.askAboutSymbol',
    async (fsPath: string, line: number, name: string, kindLabel: string) => {
      const rel = vscode.workspace.asRelativePath(fsPath)
      const prefill = `Объясни ${kindLabel.toLowerCase()} \`${name}\` из \`${rel}:${line + 1}\` — что делает, где вызывается, есть ли проблемы.`
      await openPanel(context)
      postToMain({ type: 'prefill', payload: { text: prefill } })
    }
  )

  const codeLensProvider: vscode.CodeLensProvider = {
    async provideCodeLenses(doc) {
      try {
        const symbols = (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          'vscode.executeDocumentSymbolProvider',
          doc.uri
        )) ?? []
        const out: vscode.CodeLens[] = []
        const wanted = new Set([
          vscode.SymbolKind.Function,
          vscode.SymbolKind.Method,
          vscode.SymbolKind.Class,
        ])
        const walk = (syms: vscode.DocumentSymbol[], depth = 0) => {
          for (const s of syms) {
            if (depth <= 1 && wanted.has(s.kind)) {
              const kindLabel =
                s.kind === vscode.SymbolKind.Class
                  ? 'класс'
                  : s.kind === vscode.SymbolKind.Method
                    ? 'метод'
                    : 'функцию'
              out.push(
                new vscode.CodeLens(s.range, {
                  title: '$(rocket) Ask Cockpit',
                  command: 'cockpit.askAboutSymbol',
                  arguments: [doc.uri.fsPath, s.range.start.line, s.name, kindLabel],
                })
              )
            }
            if (s.children?.length) walk(s.children, depth + 1)
          }
        }
        walk(symbols)
        return out
      } catch {
        return []
      }
    },
  }
  const lensSub = vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)

  const inlineSub = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    inlineProvider(context)
  )

  // Code Action: «Fix with Cockpit» на диагностиках.
  const fixWithCockpit = vscode.commands.registerCommand(
    'cockpit.fixWithCockpit',
    async (uri: vscode.Uri, range: vscode.Range, diagnostics: vscode.Diagnostic[]) => {
      try {
        const doc = await vscode.workspace.openTextDocument(uri)
        const rel = vscode.workspace.asRelativePath(uri)
        const lang = doc.languageId
        const startLine = Math.max(0, range.start.line - 10)
        const endLine = Math.min(doc.lineCount - 1, range.end.line + 10)
        const snippet = doc.getText(new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length))
        const diagText = diagnostics
          .map((d) => `- [${vscode.DiagnosticSeverity[d.severity]}] ${d.message}${d.source ? ` (${d.source})` : ''}`)
          .join('\n')
        const prefill =
          `Почини проблему в \`${rel}:${range.start.line + 1}\`:\n\n` +
          diagText +
          `\n\nКонтекст (строки ${startLine + 1}–${endLine + 1}):\n\n\`\`\`${lang}\n${snippet}\n\`\`\``
        await openPanel(context)
        postToMain({ type: 'prefill', payload: { text: prefill } })
      } catch (e) {
        console.error('[cockpit] fixWithCockpit:', e)
      }
    }
  )
  const codeActionProvider: vscode.CodeActionProvider = {
    provideCodeActions(_doc, range, ctx) {
      if (!ctx.diagnostics?.length) return
      const action = new vscode.CodeAction('🚀 Fix with Cockpit', vscode.CodeActionKind.QuickFix)
      action.command = {
        command: 'cockpit.fixWithCockpit',
        title: 'Fix with Cockpit',
        arguments: [_doc.uri, range, ctx.diagnostics],
      }
      action.diagnostics = [...ctx.diagnostics]
      return [action]
    },
  }
  const caSub = vscode.languages.registerCodeActionsProvider(
    { scheme: 'file' },
    codeActionProvider,
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  )

  // Explain selection inline — открывает виртуальный документ с объяснением сбоку.
  const explainContents = new Map<string, string>()
  const explainProvider: vscode.TextDocumentContentProvider = {
    onDidChangeEmitter: new vscode.EventEmitter<vscode.Uri>(),
    get onDidChange() {
      return this.onDidChangeEmitter.event
    },
    provideTextDocumentContent(uri) {
      return explainContents.get(uri.toString()) ?? '_(загружаю объяснение…)_'
    },
  } as vscode.TextDocumentContentProvider & {
    onDidChangeEmitter: vscode.EventEmitter<vscode.Uri>
  }
  const explainSub = vscode.workspace.registerTextDocumentContentProvider(
    'cockpit-explain',
    explainProvider
  )

  const explainInline = vscode.commands.registerCommand('cockpit.explainInline', async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const sel = editor.selection
    const text = editor.document.getText(sel)
    if (!text.trim()) {
      vscode.window.showInformationMessage('Cockpit: выдели фрагмент кода.')
      return
    }
    const auth = await context.secrets.get(TOKEN_KEY)
    if (!auth) {
      vscode.window.showWarningMessage('Cockpit: токен не задан.')
      return
    }
    const rel = vscode.workspace.asRelativePath(editor.document.uri)
    const lang = editor.document.languageId
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const uri = vscode.Uri.parse(`cockpit-explain:${id}.md`)
    explainContents.set(uri.toString(), `# Объяснение\n\n_Готовлю объяснение для \`${rel}\`…_`)
    ;(explainProvider as any).onDidChangeEmitter.fire(uri)
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    })
    const sysPrompt =
      'Ты — лаконичный объяснитель кода. Отвечай markdown, без длинных вступлений: что делает фрагмент, какие edge-cases/риски, и одно-два предложения общего вывода.'
    const promptText = `Файл: ${rel} (${lang}), строки ${sel.start.line + 1}–${sel.end.line + 1}.\n\n\`\`\`${lang}\n${text}\n\`\`\``
    const cancel = new vscode.CancellationTokenSource()
    try {
      const out = await quickComplete(promptText, sysPrompt, auth, cancel.token)
      explainContents.set(uri.toString(), `# Объяснение · \`${path.basename(rel)}:${sel.start.line + 1}\`\n\n${out}`)
      ;(explainProvider as any).onDidChangeEmitter.fire(uri)
    } catch (e) {
      explainContents.set(uri.toString(), `# Ошибка\n\n${e instanceof Error ? e.message : String(e)}`)
      ;(explainProvider as any).onDidChangeEmitter.fire(uri)
    } finally {
      cancel.dispose()
    }
  })

  // CLAUDE.md watcher — toast при изменении (Agent SDK подхватывает автоматом, юзер просто в курсе).
  const memoryWatcher = vscode.workspace.createFileSystemWatcher('**/CLAUDE.md', false, false, false)
  const onMemChange = () => {
    postToAll({ type: 'memoryChanged' })
    vscode.window.setStatusBarMessage('🦈 Cockpit: CLAUDE.md обновлён', 4000)
  }
  memoryWatcher.onDidChange(onMemChange)
  memoryWatcher.onDidCreate(onMemChange)

  // Watcher для шаблонов промптов — после изменения уведомляем webview.
  const root = vscode.workspace.workspaceFolders?.[0]?.uri
  let promptsWatcher: vscode.FileSystemWatcher | undefined
  if (root) {
    promptsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, '.cockpit/prompts/*.md')
    )
    promptsWatcher.onDidChange(() => void sendPrompts())
    promptsWatcher.onDidCreate(() => void sendPrompts())
    promptsWatcher.onDidDelete(() => void sendPrompts())
  }

  const runTests = vscode.commands.registerCommand('cockpit.runTestsAndFix', () =>
    runTestsAndFix(context)
  )
  const findReplace = vscode.commands.registerCommand('cockpit.aiFindReplace', () =>
    aiFindReplace(context)
  )
  const openSettingsCmd = vscode.commands.registerCommand('cockpit.openSettings', () =>
    openSettingsPanel(context)
  )

  const share = vscode.commands.registerCommand('cockpit.shareSession', async () => {
    const md = `# Cockpit · ${new Date().toLocaleString('ru')}\n\n_Открой Cockpit и используй /export для полной сессии. Эта команда работает с уже экспортированным markdown._`
    await shareSessionViaGist(md)
  })

  const toggleCompl = vscode.commands.registerCommand('cockpit.toggleCompletions', async () => {
    const cur = getSettings(context)
    const next: Settings = { ...cur, completionsEnabled: !cur.completionsEnabled }
    await context.globalState.update(SETTINGS_KEY, next)
    postToAll({ type: 'settingsUpdated', payload: { settings: next } })
    vscode.window.showInformationMessage(
      `Cockpit completions: ${next.completionsEnabled ? 'ON' : 'OFF'}`
    )
  })

  const quickAsk = vscode.commands.registerCommand('cockpit.quickAsk', async () => {
    const q = await vscode.window.showInputBox({
      title: 'Cockpit · быстрый вопрос',
      prompt: 'Спроси Клода (Enter — открыть Cockpit с этим промптом)',
      ignoreFocusOut: true,
      placeHolder: 'например: что делает auth.ts?',
    })
    if (!q?.trim()) return
    await openPanel(context)
    postToMain({ type: 'prefill', payload: { text: q.trim() } })
  })

  const previewSub = vscode.workspace.registerTextDocumentContentProvider(
    'cockpit-preview',
    previewProvider
  )

  // ── Cockpit Bridge (mobile companion) ─────────────────────────────────────
  bridge = new BridgeHost(context, {
    onPhonePrompt: async (sidFromPhone, text) => {
      if (sidFromPhone && sidFromPhone !== sessionId) {
        try {
          await loadSession(context, sidFromPhone)
        } catch {
          // session may not exist anymore — just submit into current session
        }
      }
      await onPrompt(context, text)
    },
    onPhoneDiffDecision: (diffId, decision) => {
      const resolve = pendingPermissions.get(diffId)
      if (!resolve) return
      pendingPermissions.delete(diffId)
      resolve(decision === 'approve')
      closePermissionDiff(diffId)
    },
    onPhoneSessionSwitch: async (sid) => {
      try {
        await loadSession(context, sid)
      } catch {}
    },
    getActiveSessionId: () => sessionId,
  })
  void bridge.init()
  context.subscriptions.push(bridge)

  const bridgePair = vscode.commands.registerCommand('cockpit.bridge.pair', async () => {
    if (!bridge) return
    const otp = await vscode.window.showInputBox({
      title: 'Cockpit Mobile · Pair Phone',
      prompt: 'Enter the 6-digit OTP from @CockpitMobileBot',
      placeHolder: '123456',
      ignoreFocusOut: true,
      validateInput: (v) => (/^\d{6}$/.test(v.trim()) ? undefined : 'Need 6 digits'),
    })
    if (!otp) return
    try {
      const res = await fetch('https://unyly.org/api/cockpit/pair/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          otp: otp.trim(),
          label: vscode.workspace.workspaceFolders?.[0]?.name,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { pairKey?: string; error?: string }
      if (!res.ok || !json.pairKey) {
        vscode.window.showErrorMessage(
          `Cockpit Mobile · pair failed: ${json.error ?? res.status}`,
        )
        return
      }
      await bridge.setPairKey(json.pairKey)
      vscode.window.showInformationMessage('🦈 Cockpit Mobile paired ✓')
    } catch (e) {
      vscode.window.showErrorMessage(
        `Cockpit Mobile · pair error: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  })

  const bridgeRevoke = vscode.commands.registerCommand('cockpit.bridge.revoke', async () => {
    if (!bridge) return
    const pick = await vscode.window.showWarningMessage(
      'Revoke phone pairing? The Cockpit Mobile app will disconnect.',
      { modal: true },
      'Revoke',
    )
    if (pick !== 'Revoke') return
    await bridge.revoke()
    vscode.window.showInformationMessage('Cockpit Mobile pairing revoked.')
  })

  context.subscriptions.push(
    open,
    setToken,
    autoImportToken,
    askSelection,
    askAboutSymbol,
    quickAsk,
    toggleCompl,
    runTests,
    findReplace,
    share,
    openSettingsCmd,
    statusItem,
    previewSub,
    lensSub,
    inlineSub,
    fixWithCockpit,
    caSub,
    explainSub,
    explainInline,
    memoryWatcher,
    bridgePair,
    bridgeRevoke,
    ...(promptsWatcher ? [promptsWatcher] : [])
  )
}

export function deactivate() {}

async function openPanel(context: vscode.ExtensionContext) {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One)
    return
  }
  panel = vscode.window.createWebviewPanel('cockpit', 'Cockpit', vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
  })
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'cockpit.svg')
  panel.webview.html = getHtml(panel.webview, context.extensionUri, 'main')
  panel.webview.onDidReceiveMessage(
    (msg: WebviewToHost) => handleMessage(context, msg, 'main'),
    undefined,
    context.subscriptions
  )
  panel.onDidDispose(() => (panel = undefined), undefined, context.subscriptions)
}

async function openSettingsPanel(context: vscode.ExtensionContext) {
  if (settingsPanel) {
    settingsPanel.reveal()
    return
  }
  settingsPanel = vscode.window.createWebviewPanel(
    'cockpitSettings',
    'Cockpit Settings',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
    }
  )
  settingsPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'cockpit.svg')
  settingsPanel.webview.html = getHtml(settingsPanel.webview, context.extensionUri, 'settings')
  settingsPanel.webview.onDidReceiveMessage(
    (msg: WebviewToHost) => handleMessage(context, msg, 'settings'),
    undefined,
    context.subscriptions
  )
  settingsPanel.onDidDispose(
    () => (settingsPanel = undefined),
    undefined,
    context.subscriptions
  )
}

async function sendReady(context: vscode.ExtensionContext, view: 'main' | 'sidebar' | 'settings') {
  const token = await context.secrets.get(TOKEN_KEY)
  const cost = getCost(context)
  const msg: HostToWebview = {
    type: 'ready',
    payload: {
      version: context.extension.packageJSON.version,
      workspace: vscode.workspace.workspaceFolders?.[0]?.name ?? null,
      hasToken: Boolean(token),
      theme: context.globalState.get<string>(THEME_KEY) ?? 'arcade',
      model: context.globalState.get<string>(MODEL_KEY) ?? 'default',
      costToday: cost.today,
      costTotal: cost.total,
      view,
      settings: getSettings(context),
      achievements: context.globalState.get<string[]>(ACH_KEY) ?? [],
    },
  }
  if (view === 'main') postToMain(msg)
  else if (view === 'sidebar') postToSidebar(msg)
  else postToSettings(msg)
}

async function handleMessage(
  context: vscode.ExtensionContext,
  msg: WebviewToHost,
  origin: 'main' | 'sidebar' | 'settings'
) {
  switch (msg.type) {
    case 'hello':
      await sendReady(context, origin)
      if (subscriptionLimits.size > 0) {
        postToAll({
          type: 'rateLimits',
          payload: { limits: Object.fromEntries(subscriptionLimits) },
        })
      }
      if (origin === 'sidebar') await sendSessions(context)
      if (origin === 'main') {
        const cached = context.globalState.get<string>(JOKE_CACHE_KEY)
        if (cached) postToMain({ type: 'joke', payload: { text: cached } })
        // фоном тянем свежую (если кэш старше 30 минут)
        const ts = context.globalState.get<number>(JOKE_TS_KEY) ?? 0
        if (Date.now() - ts > 30 * 60 * 1000) {
          void sendJoke(context, false)
        }
      }
      break
    case 'prompt':
      await onPrompt(context, msg.payload.text, msg.payload.attachments)
      break
    case 'updateSettings': {
      const next: Settings = { ...getSettings(context), ...msg.payload.settings }
      await context.globalState.update(SETTINGS_KEY, next)
      postToAll({ type: 'settingsUpdated', payload: { settings: next } })
      break
    }
    case 'resetCost':
      await context.globalState.update(COST_TODAY_KEY, 0)
      await context.globalState.update(COST_TOTAL_KEY, 0)
      if (statusItem) statusItem.text = `🦈 Cockpit · $0.00`
      postToAll({ type: 'cost', payload: { today: 0, total: 0 } })
      break
    case 'openWorkspaceMemory':
      await openWorkspaceMemory()
      break
    case 'listSubagents':
      await sendSubagents()
      break
    case 'listPrompts':
      await sendPrompts()
      break
    case 'savePrompt':
      await savePromptTemplate(msg.payload.name, msg.payload.content)
      await sendPrompts()
      break
    case 'deletePrompt':
      await deletePromptTemplate(msg.payload.name)
      await sendPrompts()
      break
    case 'attachProjectTree': {
      const tree = await buildProjectTree()
      postToMain({
        type: 'prefill',
        payload: {
          text:
            'Структура воркспейса:\n```\n' +
            tree +
            '\n```\n\n',
        },
      })
      break
    }
    case 'permissionResult': {
      const resolve = pendingPermissions.get(msg.payload.id)
      if (resolve) {
        pendingPermissions.delete(msg.payload.id)
        resolve(msg.payload.approved)
        if (sessionId) {
          bridge?.notifyDiffResolved(
            sessionId,
            msg.payload.id,
            msg.payload.approved ? 'approve' : 'reject',
          )
        }
      }
      closePermissionDiff(msg.payload.id)
      break
    }
    case 'stop':
      currentInterrupt?.()
      for (const id of pendingPermissions.keys()) closePermissionDiff(id)
      for (const r of pendingPermissions.values()) r(false)
      pendingPermissions.clear()
      break
    case 'reset':
    case 'newSession': {
      const prevSession = sessionId
      sessionId = undefined
      sessionCostUsd = 0
      sessionInputTokens = 0
      sessionOutputTokens = 0
      sessionCacheReadTokens = 0
      if (prevSession) bridge?.notifySessionClosed(prevSession)
      if (msg.type === 'newSession') {
        postToMain({ type: 'sessionLoaded', payload: { messages: [], sessionId: '' } })
        await sendSessions(context)
      }
      break
    }
    case 'createPullRequest':
      await createPRFromCockpit(msg.payload.title, msg.payload.body)
      break
    case 'forkFromMessage':
      await forkFromMessage(context, msg.payload.idx)
      break
    case 'shareSession':
      await shareSessionViaGist(msg.payload.markdown)
      break
    case 'runTestsAndFix':
      await runTestsAndFix(context)
      break
    case 'aiFindReplace':
      await aiFindReplace(context)
      break
    case 'openSettings':
      await openSettingsPanel(context)
      break
    case 'requestJoke':
      await sendJoke(context, false)
      break
    case 'voiceInput': {
      const isMac = process.platform === 'darwin'
      const tip = isMac
        ? 'Голос: двойной Fn запустит macOS Dictation. Enter — отправить текст в Cockpit.'
        : 'Голос: Win+H запустит системную диктовку. Enter — отправить текст в Cockpit.'
      const text = await vscode.window.showInputBox({
        title: 'Cockpit · голосовой ввод',
        prompt: tip,
        placeHolder: 'Начни диктовку…',
        ignoreFocusOut: true,
      })
      if (text?.trim()) postToMain({ type: 'prefill', payload: { text: text.trim() } })
      break
    }
    case 'speculativeAsk': {
      const auth = await context.secrets.get(TOKEN_KEY)
      if (!auth) break
      const id = `${Date.now()}`
      const cancel = new vscode.CancellationTokenSource()
      try {
        const out = await quickComplete(
          msg.payload.text,
          'Ты — быстрый ассистент. Дай короткий первичный ответ на запрос пока основной агент думает. До 120 слов.',
          auth,
          cancel.token
        )
        postToMain({ type: 'speculative', payload: { text: out, sourceId: id } })
      } catch {
        // молча
      } finally {
        cancel.dispose()
      }
      break
    }
    case 'setTheme':
      await context.globalState.update(THEME_KEY, msg.payload.theme)
      postToAll({ type: 'themeChanged', payload: { theme: msg.payload.theme } })
      break
    case 'setModel':
      await context.globalState.update(MODEL_KEY, msg.payload.model)
      postToAll({ type: 'modelChanged', payload: { model: msg.payload.model } })
      break
    case 'setToken':
      await vscode.commands.executeCommand('cockpit.setToken')
      break
    case 'autoImportToken':
      await vscode.commands.executeCommand('cockpit.autoImportToken')
      break
    case 'listSessions':
      await sendSessions(context)
      break
    case 'loadSession':
      await loadSession(context, msg.payload.sessionId)
      break
    case 'renameSession':
      await renameSessionSafe(msg.payload.sessionId, msg.payload.title)
      await sendSessions(context)
      break
    case 'deleteSession':
      await deleteSessionSafe(msg.payload.sessionId)
      bridge?.notifySessionClosed(msg.payload.sessionId)
      if (sessionId === msg.payload.sessionId) sessionId = undefined
      await sendSessions(context)
      break
    case 'forkSession':
      await forkSessionSafe(context, msg.payload.sessionId)
      break
    case 'listFiles':
      await sendFiles(msg.payload.query)
      break
    case 'openFile':
      await openFileAt(msg.payload.path, msg.payload.line)
      break
    case 'exportSession':
      await exportSessionToFile(msg.payload.markdown)
      break
    case 'log':
      console.log('[cockpit]', msg.payload.message)
      break
  }
}

async function onPrompt(
  context: vscode.ExtensionContext,
  text: string,
  attachments?: ImageAttachment[]
) {
  if (busy) return
  const auth = await context.secrets.get(TOKEN_KEY)
  if (!auth) {
    postToMain({
      type: 'error',
      payload: { message: 'Нет токена. Нажми «Задать токен» и вставь CLAUDE_CODE_OAUTH_TOKEN.' },
    })
    return
  }

  const s = getSettings(context)
  // Budget checks
  const cost = getCost(context)
  if (s.dailyBudget > 0 && cost.today >= s.dailyBudget) {
    postToMain({
      type: 'budgetExceeded',
      payload: { scope: 'day', spent: cost.today, limit: s.dailyBudget },
    })
    return
  }
  if (s.sessionBudget > 0 && sessionCostUsd >= s.sessionBudget) {
    postToMain({
      type: 'budgetExceeded',
      payload: { scope: 'session', spent: sessionCostUsd, limit: s.sessionBudget },
    })
    return
  }

  let promptText = text
  if (s.autoContext) {
    const ctx = await buildAutoContext()
    if (ctx) promptText = ctx + text
  }
  if (s.auditLog) audit('prompt', { text, hasAttachments: !!attachments?.length })

  busy = true
  const startedAt = Date.now()
  postToMain({ type: 'busy', payload: { busy: true } })
  await bumpStat(context, 'prompts')

  await runPrompt(
    promptText,
    {
      token: auth,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      resume: sessionId,
      model: context.globalState.get<string>(MODEL_KEY) ?? 'default',
      settings: s,
      attachments,
      onControl: (interrupt) => (currentInterrupt = interrupt),
    },
    {
      onSession: (id) => {
        const wasNew = sessionId !== id
        sessionId = id
        if (wasNew) bridge?.notifySessionOpened(id)
      },
      onStreamStart: () => postToMain({ type: 'streamStart' }),
      onDelta: (t) => postToMain({ type: 'delta', payload: { text: t } }),
      onTool: (name) => {
        if (s.auditLog) audit('tool', { name })
        postToMain({ type: 'tool', payload: { name } })
      },
      onResult: async (r) => {
        sessionCostUsd += r.costUsd
        sessionInputTokens += r.inputTokens ?? 0
        sessionOutputTokens += r.outputTokens ?? 0
        sessionCacheReadTokens += r.cacheReadTokens ?? 0
        postToMain({
          type: 'result',
          payload: {
            ...r,
            sessionCostUsd,
            sessionInputTokens,
            sessionOutputTokens,
            sessionCacheReadTokens,
          },
        })
        if (s.auditLog) audit('result', r)
        await addCost(context, r.costUsd)
      },
      onError: (message) => {
        if (s.auditLog) audit('error', { message })
        postToMain({ type: 'error', payload: { message } })
      },
      onRateLimit: (info) => {
        const key = info.rateLimitType ?? 'unknown'
        subscriptionLimits.set(key, info)
        postToAll({
          type: 'rateLimits',
          payload: { limits: Object.fromEntries(subscriptionLimits) },
        })
      },
      requestPermission: async (tool, input) => {
        if (s.snapshotBeforeWrite && (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit')) {
          await snapshotBeforeWrite()
        }
        if (s.auditLog) audit('permission-request', { tool, input })
        const approved = await requestPermission(tool, input)
        if (s.auditLog) audit('permission-result', { tool, approved })
        if (approved && (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit')) {
          await bumpStat(context, 'edits')
        }
        return approved
      },
    }
  )

  for (const r of pendingPermissions.values()) r(false)
  pendingPermissions.clear()
  currentInterrupt = undefined
  busy = false
  postToMain({ type: 'busy', payload: { busy: false } })
  await sendSessions(context)

  const elapsed = Date.now() - startedAt
  const settings = getSettings(context)
  const inFocus = vscode.window.state.focused && panel?.active
  if (settings.notifyOnDone && elapsed > 8000 && !inFocus) {
    vscode.window.showInformationMessage('Cockpit: ответ готов', 'Открыть').then((pick) => {
      if (pick === 'Открыть') void openPanel(context)
    })
  }
}

// ---------- sessions ----------
async function sendSessions(context: vscode.ExtensionContext) {
  if (!sidebarView && !panel) return
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const list = await sdk.listSessions({ dir: cwd, limit: 100 })
    const items: SessionEntry[] = list.map((s) => ({
      sessionId: s.sessionId,
      title: s.customTitle || s.summary || s.firstPrompt?.slice(0, 60) || 'Без названия',
      lastModified: s.lastModified,
      firstPrompt: s.firstPrompt,
      cwd: s.cwd,
    }))
    postToSidebar({ type: 'sessions', payload: { items, currentId: sessionId ?? null } })
  } catch (e) {
    console.error('[cockpit] listSessions failed:', e)
  }
}

async function loadSession(context: vscode.ExtensionContext, id: string) {
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const raw = await sdk.getSessionMessages(id, { dir: cwd, limit: 500 })
    const messages = convertSessionMessages(raw)
    sessionId = id
    await openPanel(context)
    postToMain({ type: 'sessionLoaded', payload: { messages, sessionId: id } })
    await sendSessions(context)
  } catch (e) {
    console.error('[cockpit] loadSession failed:', e)
  }
}

function convertSessionMessages(raw: unknown[]): HistoryMsg[] {
  const out: HistoryMsg[] = []
  for (const item of raw) {
    const m = item as { type?: string; message?: unknown }
    if (!m || typeof m !== 'object') continue
    const body = m.message as { role?: string; content?: unknown; usage?: unknown } | undefined
    if (m.type === 'user' && body) {
      const text = extractText(body.content)
      if (text) out.push({ role: 'user', text })
    } else if (m.type === 'assistant' && body) {
      if (Array.isArray(body.content)) {
        const textParts: string[] = []
        for (const block of body.content as any[]) {
          if (block?.type === 'text' && typeof block.text === 'string') textParts.push(block.text)
          else if (block?.type === 'tool_use' && typeof block.name === 'string')
            out.push({ role: 'tool', name: block.name })
        }
        const text = textParts.join('').trim()
        if (text) out.push({ role: 'assistant', text })
      }
    } else if ((item as any)?.type === 'result' && (item as any)?.subtype === 'success') {
      out.push({
        role: 'result',
        costUsd: (item as any).total_cost_usd,
        turns: (item as any).num_turns,
      })
    }
  }
  return out
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : ''))
      .join('')
  }
  return ''
}

async function renameSessionSafe(id: string, title: string) {
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    await sdk.renameSession(id, title)
  } catch (e) {
    console.error('[cockpit] renameSession:', e)
  }
}
async function deleteSessionSafe(id: string) {
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    await sdk.deleteSession(id)
  } catch (e) {
    console.error('[cockpit] deleteSession:', e)
  }
}
async function forkSessionSafe(context: vscode.ExtensionContext, id: string) {
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    const r = await sdk.forkSession(id)
    const newId = (r as any)?.sessionId ?? (r as any)?.session_id
    if (newId) await loadSession(context, newId)
    else await sendSessions(context)
  } catch (e) {
    console.error('[cockpit] forkSession:', e)
  }
}

// ---------- files ----------
async function sendFiles(query: string) {
  try {
    const q = query.replace(/[^\w./-]/g, '')
    const glob = q ? `**/*${q}*` : '**/*'
    const uris = await vscode.workspace.findFiles(glob, '**/node_modules/**', 50)
    const items = uris.map((u) => ({
      path: vscode.workspace.asRelativePath(u),
      name: path.basename(u.fsPath),
    }))
    postToMain({ type: 'files', payload: { query, items } })
  } catch (e) {
    console.error('[cockpit] findFiles:', e)
  }
}

async function openFileAt(p: string, line?: number) {
  const roots = vscode.workspace.workspaceFolders
  if (!roots?.length) return
  const fullPath = path.isAbsolute(p) ? p : path.join(roots[0].uri.fsPath, p)
  try {
    const uri = vscode.Uri.file(fullPath)
    const doc = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(doc, { preview: false })
    if (line && line > 0) {
      const pos = new vscode.Position(line - 1, 0)
      editor.selection = new vscode.Selection(pos, pos)
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter)
    }
  } catch (e) {
    vscode.window.showWarningMessage(`Cockpit: не удалось открыть ${p}`)
  }
}

async function openWorkspaceMemory() {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri
  if (!root) {
    vscode.window.showWarningMessage('Cockpit: открой папку воркспейса, чтобы создать CLAUDE.md')
    return
  }
  const uri = vscode.Uri.joinPath(root, 'CLAUDE.md')
  try {
    await vscode.workspace.fs.stat(uri)
  } catch {
    const template = `# CLAUDE.md

Память воркспейса для Cockpit. Эти инструкции учитываются ассистентом в каждом запросе по этому проекту.

## Стек
-

## Конвенции
-

## Полезные команды
-
`
    await vscode.workspace.fs.writeFile(uri, Buffer.from(template, 'utf8'))
  }
  const doc = await vscode.workspace.openTextDocument(uri)
  await vscode.window.showTextDocument(doc, { preview: false })
}

async function sendSubagents() {
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    const sid = sessionId
    if (!sid) {
      postToMain({ type: 'subagents', payload: { items: [] } })
      return
    }
    const names = await sdk.listSubagents(sid)
    postToMain({ type: 'subagents', payload: { items: names ?? [] } })
  } catch (e) {
    console.error('[cockpit] listSubagents:', e)
    postToMain({ type: 'subagents', payload: { items: [] } })
  }
}

function promptsDir(): string | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  return root ? path.join(root, '.cockpit', 'prompts') : undefined
}

async function sendPrompts() {
  const dir = promptsDir()
  if (!dir) {
    postToMain({ type: 'prompts', payload: { items: [] } })
    return
  }
  try {
    if (!fs.existsSync(dir)) {
      postToMain({ type: 'prompts', payload: { items: [] } })
      return
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    const items: PromptTemplate[] = files.map((f) => ({
      name: f.replace(/\.md$/, ''),
      content: fs.readFileSync(path.join(dir, f), 'utf8'),
    }))
    postToMain({ type: 'prompts', payload: { items } })
  } catch (e) {
    console.error('[cockpit] prompts:', e)
    postToMain({ type: 'prompts', payload: { items: [] } })
  }
}

async function savePromptTemplate(name: string, content: string) {
  const dir = promptsDir()
  if (!dir) return
  const safe = name.replace(/[^\w.\- ]+/g, '_').slice(0, 80)
  if (!safe) return
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${safe}.md`), content, 'utf8')
}

async function deletePromptTemplate(name: string) {
  const dir = promptsDir()
  if (!dir) return
  const safe = name.replace(/[^\w.\- ]+/g, '_')
  const f = path.join(dir, `${safe}.md`)
  try {
    fs.unlinkSync(f)
  } catch {}
}

// ---- auto-context / budget / snapshot / audit ----

function execIn(cwd: string, cmd: string, timeoutMs = 4000): Promise<string> {
  const { exec } = require('node:child_process') as typeof import('node:child_process')
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err: any, stdout: string) => {
      if (err) resolve('')
      else resolve(stdout)
    })
  })
}

async function buildAutoContext(): Promise<string> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!root) return ''
  const parts: string[] = []

  const openFiles = vscode.window.visibleTextEditors
    .map((ed) => vscode.workspace.asRelativePath(ed.document.uri))
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .slice(0, 8)
  if (openFiles.length) parts.push('Открытые файлы:\n' + openFiles.map((f) => `- ${f}`).join('\n'))

  const active = vscode.window.activeTextEditor
  if (active && !active.selection.isEmpty) {
    const sel = active.selection
    const rel = vscode.workspace.asRelativePath(active.document.uri)
    const text = active.document.getText(sel)
    if (text.length < 1200) {
      parts.push(
        `Текущее выделение (${rel}:${sel.start.line + 1}–${sel.end.line + 1}):\n\`\`\`${active.document.languageId}\n${text}\n\`\`\``
      )
    }
  }

  const diff = (await execIn(root, 'git diff --stat')).trim()
  if (diff && diff.length < 2000) {
    parts.push('Незакоммиченные изменения:\n```\n' + diff + '\n```')
  } else if (diff) {
    parts.push('Много незакоммиченных изменений (git diff --stat усечён).')
  }

  if (parts.length === 0) return ''
  return '_(Auto-context)_\n\n' + parts.join('\n\n') + '\n\n---\n\n'
}

async function snapshotBeforeWrite(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!root) return
  const label = `cockpit-${Date.now()}`
  await execIn(root, `git stash push -k -u -m "${label}"`)
}

function auditPath(): string | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  return root ? path.join(root, '.cockpit', 'audit.log') : undefined
}

function audit(kind: string, payload: unknown) {
  const p = auditPath()
  if (!p) return
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.appendFileSync(p, JSON.stringify({ t: new Date().toISOString(), kind, payload }) + '\n')
  } catch {}
}

async function buildProjectTree(): Promise<string> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!root) return '(нет воркспейса)'
  const SKIP = new Set([
    'node_modules',
    '.git',
    'dist',
    'out',
    'build',
    '.next',
    '.turbo',
    'coverage',
    '.cache',
    '.venv',
    'venv',
    '__pycache__',
  ])
  const lines: string[] = []
  let count = 0
  const MAX = 200
  const walk = (dir: string, prefix: string, depth: number) => {
    if (depth > 3 || count >= MAX) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries = entries
      .filter((e) => !e.name.startsWith('.') || ['.env', '.gitignore'].includes(e.name))
      .filter((e) => !SKIP.has(e.name))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    for (let i = 0; i < entries.length && count < MAX; i++) {
      const e = entries[i]
      const isLast = i === entries.length - 1
      const branch = isLast ? '└─ ' : '├─ '
      lines.push(prefix + branch + e.name + (e.isDirectory() ? '/' : ''))
      count++
      if (e.isDirectory()) {
        walk(path.join(dir, e.name), prefix + (isLast ? '   ' : '│  '), depth + 1)
      }
    }
  }
  lines.push(path.basename(root) + '/')
  walk(root, '', 0)
  if (count >= MAX) lines.push(`… (показаны первые ${MAX} элементов)`)
  return lines.join('\n')
}

async function quickComplete(
  promptText: string,
  systemPrompt: string,
  token: string,
  cancellation: vscode.CancellationToken
): Promise<string> {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token
  delete process.env.ANTHROPIC_API_KEY
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const q = sdk.query({
    prompt: promptText,
    options: {
      model: 'haiku',
      allowedTools: [],
      canUseTool: async () => ({ behavior: 'deny', message: '' }),
      includePartialMessages: false,
      systemPrompt,
    } as any,
  })
  const dispose = cancellation.onCancellationRequested(() => {
    void q.interrupt()
  })
  let out = ''
  try {
    for await (const msg of q) {
      if (cancellation.isCancellationRequested) break
      if (msg.type === 'assistant' && Array.isArray((msg as any).message?.content)) {
        for (const b of (msg as any).message.content) {
          if (b?.type === 'text' && typeof b.text === 'string') out += b.text
        }
      } else if (msg.type === 'result') {
        break
      }
    }
  } finally {
    dispose.dispose()
  }
  return out
}

// LRU кеш inline-completions: prefix-tail+suffix-head → completion.
const completionCache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()
const cacheSetWithLimit = (key: string, value: string) => {
  completionCache.delete(key)
  completionCache.set(key, value)
  while (completionCache.size > 64) {
    const first = completionCache.keys().next().value
    if (first !== undefined) completionCache.delete(first)
    else break
  }
}

const inlineProvider = (ctx: vscode.ExtensionContext): vscode.InlineCompletionItemProvider => ({
  async provideInlineCompletionItems(document, position, context, token) {
    const s = getSettings(ctx)
    if (!s.completionsEnabled) return null
    if (
      context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic &&
      !s.completionsAutoTrigger
    ) {
      return null
    }
    const auth = await ctx.secrets.get(TOKEN_KEY)
    if (!auth) return null

    const lineCount = document.lineCount
    const startLine = Math.max(0, position.line - 60)
    const prefixRange = new vscode.Range(startLine, 0, position.line, position.character)
    const endLine = Math.min(lineCount - 1, position.line + 20)
    const endChar = document.lineAt(endLine).text.length
    const suffixRange = new vscode.Range(position.line, position.character, endLine, endChar)
    let prefix = document.getText(prefixRange)
    let suffix = document.getText(suffixRange)
    if (prefix.length > 2400) prefix = prefix.slice(-2400)
    if (suffix.length > 800) suffix = suffix.slice(0, 800)
    if (!prefix.trim() && !suffix.trim()) return null

    const rel = vscode.workspace.asRelativePath(document.uri)
    const lang = document.languageId
    // Ключ кеша: язык + хвост префикса (последние 200) + начало суффикса (первые 100).
    // Маленькие правки рядом → попадание в кеш.
    const key = `${lang}${prefix.slice(-200)}${suffix.slice(0, 100)}`
    const cached = completionCache.get(key)
    if (cached) return [new vscode.InlineCompletionItem(cached, new vscode.Range(position, position))]

    const promptText =
      `Файл: ${rel} (${lang})\n` +
      `Префикс:\n<<<\n${prefix}\n>>>\n` +
      `Суффикс:\n<<<\n${suffix}\n>>>\n` +
      `Верни ТОЛЬКО код, который должен встать на место между префиксом и суффиксом. Без объяснений, без markdown-обёрток, без повторения префикса/суффикса.`
    const systemPrompt =
      `Ты — движок автодополнения кода. Отвечай ТОЛЬКО кодом, который вставляется между указанным префиксом и суффиксом. Без объяснений, без markdown-fence. Сохраняй стиль кода, отступы и соглашения файла.`

    try {
      // Дедупликация: один и тот же key — не запускаем второй параллельный запрос.
      let pending = inflight.get(key)
      if (!pending) {
        pending = quickComplete(promptText, systemPrompt, auth, token)
        inflight.set(key, pending)
        pending.finally(() => inflight.delete(key))
      }
      const out = await pending
      if (token.isCancellationRequested) return null
      let clean = out.trim()
      clean = clean.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
      if (!clean) return null
      cacheSetWithLimit(key, clean)
      return [
        new vscode.InlineCompletionItem(clean, new vscode.Range(position, position)),
      ]
    } catch {
      return null
    }
  },
})

async function createPRFromCockpit(title?: string, body?: string) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!root) {
    vscode.window.showWarningMessage('Cockpit: открой папку проекта.')
    return
  }
  const args = ['pr', 'create']
  if (title) args.push('--title', JSON.stringify(title))
  else args.push('--fill')
  if (body) args.push('--body', JSON.stringify(body))
  const cmd = `gh ${args.join(' ')}`
  const term = vscode.window.createTerminal({ name: 'Cockpit: gh pr create', cwd: root })
  term.show(true)
  term.sendText(cmd)
}

async function forkFromMessage(context: vscode.ExtensionContext, _idx: number) {
  if (!sessionId) {
    vscode.window.showWarningMessage('Cockpit: нет активной сессии для форка.')
    return
  }
  await forkSessionSafe(context, sessionId)
  await bumpStat(context, 'forks')
}

const JOKE_CACHE_KEY = 'cockpit.lastJoke'
const JOKE_TS_KEY = 'cockpit.lastJokeTs'
let jokeInflight: Promise<void> | undefined

async function sendJoke(context: vscode.ExtensionContext, allowCache: boolean) {
  if (jokeInflight) return jokeInflight
  const auth = await context.secrets.get(TOKEN_KEY)
  if (!auth) return
  const ts = context.globalState.get<number>(JOKE_TS_KEY) ?? 0
  const cached = context.globalState.get<string>(JOKE_CACHE_KEY)
  if (allowCache && cached && Date.now() - ts < 6 * 60 * 1000) {
    postToMain({ type: 'joke', payload: { text: cached } })
    return
  }
  jokeInflight = (async () => {
    const sys =
      'Ты циничный, дружелюбно-сардонический робот-ассистент. Сгенерируй ОДНУ короткую шутку-приветствие или подкол ' +
      'для пользователя-человека. Используй мемы про "кожаного мешка", "углеродную форму жизни", "теплокровного", ' +
      '"носителя ДНК", "белкового" и т.п. ОДНА фраза, до 90 символов, на русском, без кавычек, без эмодзи в конце. ' +
      'Каждый раз новая, не повторяйся со штампами вроде "Привет, кожаный".'
    const prompt = 'Дай новую короткую шутку-приветствие.'
    const cancel = new vscode.CancellationTokenSource()
    try {
      const out = await quickComplete(prompt, sys, auth, cancel.token)
      const text = out.trim().replace(/^["«»\s]+|["«»\s]+$/g, '')
      if (text) {
        await context.globalState.update(JOKE_CACHE_KEY, text)
        await context.globalState.update(JOKE_TS_KEY, Date.now())
        postToMain({ type: 'joke', payload: { text } })
      }
    } catch {
      // молча
    } finally {
      cancel.dispose()
      jokeInflight = undefined
    }
  })()
  return jokeInflight
}

async function shareSessionViaGist(markdown: string) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? require('os').tmpdir()
  const tmp = path.join(root, `.cockpit-share-${Date.now()}.md`)
  fs.writeFileSync(tmp, markdown, 'utf8')
  const { exec } = require('node:child_process') as typeof import('node:child_process')
  exec(`gh gist create -d "Cockpit session" "${tmp}"`, { cwd: root }, (err, stdout) => {
    try {
      fs.unlinkSync(tmp)
    } catch {}
    if (err) {
      vscode.window.showWarningMessage(
        'Cockpit: не удалось создать Gist. Проверь что `gh` установлен и аутентифицирован.'
      )
      return
    }
    const url = stdout.trim().split('\n').pop() || ''
    if (url.startsWith('http')) {
      vscode.env.clipboard.writeText(url)
      vscode.window
        .showInformationMessage(`Cockpit: ссылка скопирована — ${url}`, 'Открыть')
        .then((pick) => {
          if (pick === 'Открыть') vscode.env.openExternal(vscode.Uri.parse(url))
        })
    } else {
      vscode.window.showInformationMessage('Cockpit: gist создан, но URL не извлёкся.')
    }
  })
}

async function runTestsAndFix(context: vscode.ExtensionContext) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!root) return
  const presets = [
    'pnpm test',
    'npm test',
    'yarn test',
    'pnpm test:run',
    'go test ./...',
    'pytest -q',
    'cargo test',
  ]
  const pick = await vscode.window.showQuickPick([...presets, '➤ Своя команда…'], {
    title: 'Cockpit: команда тестов',
  })
  if (!pick) return
  let cmd = pick
  if (pick.startsWith('➤')) {
    const custom = await vscode.window.showInputBox({ title: 'Введи команду тестов' })
    if (!custom) return
    cmd = custom
  }
  const ch = vscode.window.createOutputChannel('Cockpit Tests')
  ch.show(true)
  ch.appendLine(`▸ ${cmd}\n`)
  const { spawn } = require('node:child_process') as typeof import('node:child_process')
  const proc = spawn(cmd, { cwd: root, shell: true })
  let output = ''
  proc.stdout?.on('data', (b: Buffer) => {
    const s = b.toString()
    output += s
    ch.append(s)
  })
  proc.stderr?.on('data', (b: Buffer) => {
    const s = b.toString()
    output += s
    ch.append(s)
  })
  proc.on('close', async (code) => {
    ch.appendLine(`\n▸ exit ${code}`)
    if (code === 0) {
      vscode.window.showInformationMessage('Cockpit: тесты прошли ✓')
      return
    }
    const tail = output.split('\n').slice(-120).join('\n')
    const prefill =
      `Команда \`${cmd}\` упала с кодом ${code}. Разбери падение и предложи правку:\n\n\`\`\`\n${tail}\n\`\`\``
    await openPanel(context)
    postToMain({ type: 'prefill', payload: { text: prefill } })
  })
}

async function aiFindReplace(context: vscode.ExtensionContext) {
  const what = await vscode.window.showInputBox({
    title: 'Cockpit · что найти/изменить (опиши по смыслу)',
    placeHolder: 'например: переименуй getUser → fetchUser везде где это пользовательский фетчер',
  })
  if (!what?.trim()) return
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
  const prefill =
    `Найди и измени по всему воркспейсу (${root}). Используй Grep/Glob/Read для поиска, потом Edit для правок (с подтверждениями):\n\n${what}`
  await openPanel(context)
  postToMain({ type: 'prefill', payload: { text: prefill } })
}

async function exportSessionToFile(markdown: string) {
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(
      path.join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? require('os').homedir(),
        `cockpit-session-${new Date().toISOString().slice(0, 10)}.md`
      )
    ),
    filters: { Markdown: ['md'] },
  })
  if (!target) return
  fs.writeFileSync(target.fsPath, markdown, 'utf8')
  vscode.window.showInformationMessage(`Cockpit: сохранено в ${path.basename(target.fsPath)}`)
}

// ---------- html ----------
function getHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  view: 'main' | 'sidebar' | 'settings'
): string {
  const distRoot = vscode.Uri.joinPath(extensionUri, 'out', 'webview')
  const indexPath = vscode.Uri.joinPath(distRoot, 'index.html')
  let html = fs.readFileSync(indexPath.fsPath, 'utf8')

  html = html.replace(/(src|href)="(\.?\/)?(assets\/[^"]+)"/g, (_m, attr, _slash, p) => {
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(distRoot, p))
    return `${attr}="${uri}"`
  })

  html = html.replace('<html ', `<html data-cockpit-view="${view}" `)

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `script-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${webview.cspSource} https://fonts.gstatic.com`,
  ].join('; ')
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
  return html.replace('<head>', `<head>\n    ${meta}`)
}
