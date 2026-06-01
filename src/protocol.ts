// Типизированный протокол обмена между extension host и webview.

export type PermissionDetail =
  | { kind: 'edit'; file: string; oldText: string; newText: string }
  | { kind: 'write'; file: string; content: string }
  | { kind: 'bash'; command: string; description?: string }
  | { kind: 'other'; tool: string; input: Record<string, unknown> }

export interface SessionEntry {
  sessionId: string
  title: string
  lastModified: number
  firstPrompt?: string
  cwd?: string
}

export interface HistoryMsg {
  role: 'user' | 'assistant' | 'tool' | 'result' | 'error'
  text?: string
  name?: string
  costUsd?: number
  turns?: number
}

export interface FileEntry {
  path: string
  name: string
}

export interface ImageAttachment {
  data: string // base64 без префикса data:
  mediaType: string // image/png, image/jpeg, ...
  name?: string
}

export interface Settings {
  systemPrompt: string
  maxTurns: number
  autoApprove: 'asking' | 'edits' | 'all'
  fontScale: number
  customDisallowBash: string
  mcpServers: string
  notifyOnDone: boolean
  completionsEnabled: boolean
  completionsAutoTrigger: boolean
  customTheme: Record<string, string> // CSS-переменные → значения для темы "custom"
  autoContext: boolean
  allowedEditPaths: string // glob patterns через пробел; пусто = всё разрешено
  dailyBudget: number // USD; 0 = без лимита
  sessionBudget: number // USD; 0 = без лимита
  snapshotBeforeWrite: boolean
  auditLog: boolean
  webSearch: boolean
  webFetch: boolean
  pomodoroMinutes: number // 0 = выкл
  companionEnabled: boolean
  speculativeHaiku: boolean
  locale: 'auto' | 'ru' | 'en'
}

export const DEFAULT_SETTINGS: Settings = {
  systemPrompt: '',
  maxTurns: 0,
  autoApprove: 'asking',
  fontScale: 1,
  customDisallowBash: '',
  mcpServers: '',
  notifyOnDone: true,
  completionsEnabled: false,
  completionsAutoTrigger: false,
  customTheme: {},
  autoContext: false,
  allowedEditPaths: '',
  dailyBudget: 0,
  sessionBudget: 0,
  snapshotBeforeWrite: false,
  auditLog: false,
  webSearch: false,
  webFetch: false,
  pomodoroMinutes: 0,
  companionEnabled: true,
  speculativeHaiku: false,
  locale: 'auto',
}

export interface PromptTemplate {
  name: string
  content: string
}

export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  resetsAt?: number
  rateLimitType?:
    | 'five_hour'
    | 'seven_day'
    | 'seven_day_opus'
    | 'seven_day_sonnet'
    | 'overage'
  utilization?: number
  isUsingOverage?: boolean
}

export type HostToWebview =
  | {
      type: 'ready'
      payload: {
        version: string
        workspace: string | null
        hasToken: boolean
        theme: string
        model: string
        costToday: number
        costTotal: number
        view?: 'main' | 'sidebar' | 'settings'
        settings: Settings
        achievements?: string[]
        bridge?: { paired: boolean; instanceId: string; pairedAt?: number; pairLabel?: string }
        /** Resolved effective locale — `auto` setting -> 'ru' if VSCode UI is
         *  Russian, else 'en'. Webview uses this for its i18n. */
        locale: 'ru' | 'en'
      }
    }
  | { type: 'streamStart' }
  | { type: 'delta'; payload: { text: string } }
  | { type: 'tool'; payload: { name: string } }
  | { type: 'permission'; payload: { id: string; detail: PermissionDetail } }
  | {
      type: 'result'
      payload: {
        costUsd: number
        turns: number
        inputTokens?: number
        outputTokens?: number
        cacheReadTokens?: number
        cacheCreationTokens?: number
        sessionCostUsd?: number
        sessionInputTokens?: number
        sessionOutputTokens?: number
        sessionCacheReadTokens?: number
      }
    }
  | { type: 'error'; payload: { message: string } }
  | { type: 'busy'; payload: { busy: boolean } }
  | { type: 'tokenChanged'; payload: { hasToken: boolean } }
  | { type: 'cost'; payload: { today: number; total: number } }
  | { type: 'sessions'; payload: { items: SessionEntry[]; currentId: string | null } }
  | { type: 'sessionLoaded'; payload: { messages: HistoryMsg[]; sessionId: string } }
  | { type: 'files'; payload: { query: string; items: FileEntry[] } }
  | { type: 'prefill'; payload: { text: string } }
  | { type: 'settingsUpdated'; payload: { settings: Settings } }
  | { type: 'subagents'; payload: { items: string[] } }
  | { type: 'prompts'; payload: { items: PromptTemplate[] } }
  | { type: 'memoryChanged' }
  | { type: 'budgetExceeded'; payload: { scope: 'day' | 'session'; spent: number; limit: number } }
  | { type: 'achievement'; payload: { id: string; label: string; emoji: string } }
  | { type: 'speculative'; payload: { text: string; sourceId: string } }
  | { type: 'rateLimits'; payload: { limits: Record<string, RateLimitInfo> } }
  | { type: 'joke'; payload: { text: string } }
  | { type: 'themeChanged'; payload: { theme: string } }
  | { type: 'modelChanged'; payload: { model: string } }
  | {
      type: 'bridgeStatus'
      payload: { paired: boolean; instanceId: string; pairedAt?: number; pairLabel?: string }
    }
  | { type: 'bridgeResult'; payload: { ok: boolean; message?: string } }
  | {
      type: 'bridgeCode'
      payload:
        | { ok: true; token: string; deepLink: string; expiresAt: string }
        | { ok: false; message: string }
    }

export type WebviewToHost =
  | { type: 'hello'; payload: { view: 'main' | 'sidebar' | 'settings' } }
  | { type: 'openSettings' }
  | { type: 'prompt'; payload: { text: string; attachments?: ImageAttachment[] } }
  | { type: 'permissionResult'; payload: { id: string; approved: boolean } }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'setTheme'; payload: { theme: string } }
  | { type: 'setModel'; payload: { model: string } }
  | { type: 'setToken' }
  | { type: 'autoImportToken' }
  | { type: 'log'; payload: { message: string } }
  | { type: 'listSessions' }
  | { type: 'loadSession'; payload: { sessionId: string } }
  | { type: 'renameSession'; payload: { sessionId: string; title: string } }
  | { type: 'deleteSession'; payload: { sessionId: string } }
  | { type: 'forkSession'; payload: { sessionId: string } }
  | { type: 'newSession' }
  | { type: 'listFiles'; payload: { query: string } }
  | { type: 'openFile'; payload: { path: string; line?: number } }
  | { type: 'exportSession'; payload: { markdown: string } }
  | { type: 'updateSettings'; payload: { settings: Partial<Settings> } }
  | { type: 'resetCost' }
  | { type: 'openWorkspaceMemory' }
  | { type: 'listSubagents' }
  | { type: 'attachProjectTree' }
  | { type: 'listPrompts' }
  | { type: 'savePrompt'; payload: { name: string; content: string } }
  | { type: 'deletePrompt'; payload: { name: string } }
  | { type: 'createPullRequest'; payload: { title?: string; body?: string } }
  | { type: 'forkFromMessage'; payload: { idx: number } }
  | { type: 'shareSession'; payload: { markdown: string } }
  | { type: 'runTestsAndFix' }
  | { type: 'aiFindReplace' }
  | { type: 'speculativeAsk'; payload: { text: string } }
  | { type: 'voiceInput' }
  | { type: 'requestJoke' }
  | { type: 'bridgeQueryStatus' }
  | { type: 'bridgePair'; payload: { otp: string } }
  | { type: 'bridgeRevoke' }
  | { type: 'bridgeGenerateCode' }
