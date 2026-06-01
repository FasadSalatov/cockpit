import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  Settings,
  RateLimitInfo,
  PromptTemplate,
} from '../../src/protocol'
import { DEFAULT_SETTINGS } from '../../src/protocol'
import { onMessage, post } from './vscode'
import { Px } from './components/px'
import { LocaleContext, useT, type Locale } from './i18n'
import {
  ACHIEVEMENTS_META,
  CUSTOM_THEME_FIELDS,
  MODELS,
  RATE_LIMIT_ORDER,
  SYSTEM_PRESETS,
  THEMES,
  THEME_PREVIEW,
  compactNum,
  parseMcpServers,
  serializeMcpServers,
  timeUntil,
  type McpServer,
} from './lib/settings-shared'

type CategoryId =
  | 'account'
  | 'mobile'
  | 'appearance'
  | 'behavior'
  | 'security'
  | 'tools'
  | 'memory'
  | 'mcp'
  | 'prompts'
  | 'limits'
  | 'achievements'

const CATEGORIES: { id: CategoryId; label: string; icon: string }[] = [
  { id: 'account', label: 'Аккаунт', icon: 'lock' },
  { id: 'mobile', label: 'Cockpit Mobile', icon: 'smartphone' },
  { id: 'appearance', label: 'Внешний вид', icon: 'image' },
  { id: 'behavior', label: 'Поведение', icon: 'android' },
  { id: 'security', label: 'Безопасность', icon: 'check' },
  { id: 'tools', label: 'Внешние tools', icon: 'search' },
  { id: 'memory', label: 'Память', icon: 'book' },
  { id: 'mcp', label: 'MCP-серверы', icon: 'command' },
  { id: 'prompts', label: 'Шаблоны', icon: 'file-multiple' },
  { id: 'limits', label: 'Лимиты подписки', icon: 'sparkle' },
  { id: 'achievements', label: 'Achievements', icon: 'sparkles' },
]

type BridgeStatus = {
  paired: boolean
  instanceId: string
  pairedAt?: number
  pairLabel?: string
}

type BridgeCode =
  | { ok: true; token: string; deepLink: string; expiresAt: string; qrDataUrl?: string }
  | { ok: false; message: string }

export function SettingsApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [locale, setLocale] = useState<Locale>('en')
  const [theme, setTheme] = useState('arcade')
  const [hasToken, setHasToken] = useState(false)
  const [costToday, setCostToday] = useState(0)
  const [costTotal, setCostTotal] = useState(0)
  const [sessionCost, setSessionCost] = useState(0)
  const [sessionInput, setSessionInput] = useState(0)
  const [sessionOutput, setSessionOutput] = useState(0)
  const [sessionCache, setSessionCache] = useState(0)
  const [limits, setLimits] = useState<Record<string, RateLimitInfo>>({})
  const [subagents, setSubagents] = useState<string[]>([])
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [achievements, setAchievements] = useState<string[]>([])
  const [active, setActive] = useState<CategoryId>('account')
  const [search, setSearch] = useState('')
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null)
  const [bridgeOtp, setBridgeOtp] = useState('')
  const [bridgeBusy, setBridgeBusy] = useState(false)
  const [bridgeMsg, setBridgeMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [bridgeCode, setBridgeCode] = useState<BridgeCode | null>(null)
  const [bridgeCodeBusy, setBridgeCodeBusy] = useState(false)

  useEffect(() => {
    const off = onMessage((m) => {
      switch (m.type) {
        case 'ready':
          setTheme(m.payload.theme)
          setHasToken(m.payload.hasToken)
          setSettings(m.payload.settings ?? DEFAULT_SETTINGS)
          setCostToday(m.payload.costToday)
          setCostTotal(m.payload.costTotal)
          if (m.payload.achievements) setAchievements(m.payload.achievements)
          if (m.payload.bridge) setBridgeStatus(m.payload.bridge)
          if (m.payload.locale) setLocale(m.payload.locale)
          break
        case 'settingsUpdated':
          setSettings(m.payload.settings)
          break
        case 'bridgeStatus':
          setBridgeStatus(m.payload)
          break
        case 'bridgeResult':
          setBridgeBusy(false)
          if (m.payload.ok) {
            setBridgeOtp('')
            setBridgeMsg({ ok: true, text: 'Спарено ✓' })
          } else {
            setBridgeMsg({ ok: false, text: m.payload.message || 'Ошибка' })
          }
          break
        case 'bridgeCode':
          setBridgeCodeBusy(false)
          if (m.payload.ok) {
            const payload = m.payload
            // Render QR client-side (qrcode lib in webview bundle). Falls back
            // gracefully to text-only if the lib is missing.
            import('qrcode')
              .then((mod) =>
                mod.toDataURL(payload.deepLink, {
                  margin: 1,
                  scale: 6,
                  color: { dark: '#0a0a0f', light: '#ffffff' },
                }),
              )
              .then((qrDataUrl) =>
                setBridgeCode({
                  ok: true,
                  token: payload.token,
                  deepLink: payload.deepLink,
                  expiresAt: payload.expiresAt,
                  qrDataUrl,
                }),
              )
              .catch(() =>
                setBridgeCode({
                  ok: true,
                  token: payload.token,
                  deepLink: payload.deepLink,
                  expiresAt: payload.expiresAt,
                }),
              )
          } else {
            setBridgeCode({ ok: false, message: m.payload.message })
          }
          break
        case 'cost':
          setCostToday(m.payload.today)
          setCostTotal(m.payload.total)
          break
        case 'tokenChanged':
          setHasToken(m.payload.hasToken)
          break
        case 'themeChanged':
          setTheme(m.payload.theme)
          break
        case 'result':
          if (m.payload.sessionCostUsd != null) setSessionCost(m.payload.sessionCostUsd)
          if (m.payload.sessionInputTokens != null) setSessionInput(m.payload.sessionInputTokens)
          if (m.payload.sessionOutputTokens != null) setSessionOutput(m.payload.sessionOutputTokens)
          if (m.payload.sessionCacheReadTokens != null) setSessionCache(m.payload.sessionCacheReadTokens)
          break
        case 'rateLimits':
          setLimits(m.payload.limits)
          break
        case 'subagents':
          setSubagents(m.payload.items)
          break
        case 'prompts':
          setPrompts(m.payload.items)
          break
        case 'achievement':
          setAchievements((cur) => (cur.includes(m.payload.id) ? cur : [...cur, m.payload.id]))
          break
      }
    })
    post({ type: 'hello', payload: { view: 'settings' } })
    post({ type: 'listPrompts' })
    return off
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    const el = document.documentElement
    for (const f of CUSTOM_THEME_FIELDS) el.style.removeProperty(f.key)
    if (theme === 'custom') {
      for (const f of CUSTOM_THEME_FIELDS) {
        const v = settings.customTheme[f.key]
        if (v) el.style.setProperty(f.key, v)
      }
    }
  }, [theme, settings.customTheme])

  const update = (patch: Partial<Settings>) =>
    post({ type: 'updateSettings', payload: { settings: patch } })

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return CATEGORIES
    const q = search.toLowerCase()
    return CATEGORIES.filter((c) => c.label.toLowerCase().includes(q))
  }, [search])

  return (
    <LocaleContext.Provider value={locale}>
    <div className="flex h-full overflow-hidden bg-background text-foreground">
      {/* боковая навигация */}
      <aside className="flex w-56 shrink-0 flex-col border-r-2 border-border bg-card/50">
        <div className="flex items-center gap-2 border-b-2 border-border px-3 py-3">
          <span className="grid size-7 place-items-center border-2 border-foreground bg-pixel-magenta text-white shadow-[2px_2px_0_0_var(--foreground)]">
            <Px name="sliders" className="size-4" />
          </span>
          <h1 className="text-base font-extrabold tracking-tight">Settings</h1>
        </div>
        <div className="border-b border-border p-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="поиск…"
            className="w-full border-2 border-input bg-background px-2 py-1 text-xs outline-none focus:border-pixel-magenta"
          />
        </div>
        <nav className="flex-1 overflow-y-auto py-1">
          {filteredCategories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                active === c.id
                  ? 'border-l-2 border-pixel-magenta bg-pixel-magenta/15 text-foreground'
                  : 'border-l-2 border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Px name={c.icon} className="size-3.5" />
              {c.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-border p-3 font-mono text-[10px] text-muted-foreground">
          сессия ${sessionCost.toFixed(4)} · сегодня ${costToday.toFixed(2)}
        </div>
      </aside>

      {/* основная область */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {active === 'account' && (
            <Section title="Подключение Claude (подписка)">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`flex items-center gap-2 border-2 px-2 py-1 font-mono text-xs ${
                    hasToken
                      ? 'border-pixel-lime/60 text-pixel-lime'
                      : 'border-pixel-coral/60 text-pixel-coral'
                  }`}
                >
                  <Px name="lock" className="size-3.5" />
                  {hasToken ? 'токен задан' : 'токен не задан'}
                </span>
                <button
                  onClick={() => post({ type: 'autoImportToken' })}
                  className="border-2 border-foreground bg-pixel-lime px-3 py-1 text-xs font-semibold text-black shadow-[2px_2px_0_0_var(--foreground)] hover:bg-pixel-cyan"
                  title="Прочитать токен из macOS Keychain (нужен установленный Claude CLI после setup-token)"
                >
                  🦈 Подхватить из Claude CLI
                </button>
                <button
                  onClick={() => post({ type: 'setToken' })}
                  className="border-2 border-foreground bg-background px-3 py-1 text-xs font-semibold shadow-[2px_2px_0_0_var(--foreground)] hover:bg-pixel-magenta/15"
                >
                  {hasToken ? 'Сменить вручную' : 'Вставить вручную'}
                </button>
                <span className="text-[11px] text-muted-foreground">
                  Если нет CLI: <code className="font-mono">npm i -g @anthropic-ai/claude-code &amp;&amp; claude setup-token</code>
                </span>
              </div>
              <LocaleSelector value={settings.locale} onChange={(v) => update({ locale: v })} />
            </Section>
          )}

          {active === 'mobile' && (
            <Section title="Cockpit Mobile — пульт твоего AI с телефона">
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`flex items-center gap-2 border-2 px-2 py-1 font-mono text-xs ${
                      bridgeStatus?.paired
                        ? 'border-pixel-lime/60 text-pixel-lime'
                        : 'border-pixel-coral/60 text-pixel-coral'
                    }`}
                  >
                    <Px name="smartphone" className="size-3.5" />
                    {bridgeStatus?.paired ? 'спарен' : 'не спарен'}
                  </span>
                  {bridgeStatus?.pairLabel ? (
                    <span className="text-[11px] text-muted-foreground">
                      label: <code className="font-mono">{bridgeStatus.pairLabel}</code>
                    </span>
                  ) : null}
                  {bridgeStatus?.pairedAt ? (
                    <span className="text-[11px] text-muted-foreground">
                      paired {new Date(bridgeStatus.pairedAt).toLocaleString()}
                    </span>
                  ) : null}
                </div>

                {bridgeStatus?.paired ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Открой <code className="font-mono">@CockpitMobileBot</code> в Telegram и
                      жми «🦈 Открыть Cockpit Mobile» — сессии этого инстанса видны на телефоне.
                    </p>
                    <button
                      onClick={() => {
                        setBridgeMsg(null)
                        setBridgeBusy(true)
                        post({ type: 'bridgeRevoke' })
                      }}
                      disabled={bridgeBusy}
                      className="border-2 border-foreground bg-pixel-coral/20 px-3 py-1 text-xs font-semibold shadow-[2px_2px_0_0_var(--foreground)] hover:bg-pixel-coral/40 disabled:opacity-50"
                    >
                      Отвязать телефон
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                      <li>Нажми «Сгенерировать код» ↓.</li>
                      <li>
                        Открой <code className="font-mono">@CockpitMobileBot</code> в Telegram (или
                        отсканируй QR с экрана) — миниапп откроется автоматически.
                      </li>
                      <li>
                        Если миниапп открыт руками — введи 8-символьный код в форме «Спарить ПК».
                      </li>
                    </ol>
                    <button
                      onClick={() => {
                        setBridgeCode(null)
                        setBridgeCodeBusy(true)
                        post({ type: 'bridgeGenerateCode' })
                      }}
                      disabled={bridgeCodeBusy}
                      className="border-2 border-foreground bg-pixel-lime px-3 py-1 text-xs font-semibold text-black shadow-[2px_2px_0_0_var(--foreground)] hover:bg-pixel-cyan disabled:opacity-50"
                    >
                      {bridgeCodeBusy ? 'генерирую…' : 'Сгенерировать код'}
                    </button>
                    {bridgeCode && bridgeCode.ok ? (
                      <div className="space-y-3 border-2 border-foreground bg-background p-3 shadow-[4px_4px_0_0_var(--foreground)]">
                        <div className="flex flex-wrap items-center gap-4">
                          {bridgeCode.qrDataUrl ? (
                            <img
                              src={bridgeCode.qrDataUrl}
                              alt="QR for pairing"
                              className="size-44 border-2 border-foreground"
                            />
                          ) : (
                            <div className="flex size-44 items-center justify-center border-2 border-foreground text-[10px] text-muted-foreground">
                              QR недоступен
                            </div>
                          )}
                          <div className="flex min-w-0 flex-1 flex-col gap-2 text-xs">
                            <div className="text-muted-foreground">Код для ввода в миниаппе:</div>
                            <div className="font-mono text-3xl tracking-widest text-pixel-lime">
                              {bridgeCode.token}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              Действует 5 минут, одноразовый.
                            </div>
                            <a
                              href={bridgeCode.deepLink}
                              target="_blank"
                              rel="noreferrer"
                              className="break-all text-[11px] text-pixel-cyan underline"
                            >
                              {bridgeCode.deepLink}
                            </a>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {bridgeCode && !bridgeCode.ok ? (
                      <div className="border-2 border-pixel-coral/60 px-2 py-1 text-xs text-pixel-coral">
                        Ошибка: {bridgeCode.message}
                      </div>
                    ) : null}
                  </div>
                )}

                {bridgeMsg ? (
                  <div
                    className={`border-2 px-2 py-1 text-xs ${
                      bridgeMsg.ok
                        ? 'border-pixel-lime/60 text-pixel-lime'
                        : 'border-pixel-coral/60 text-pixel-coral'
                    }`}
                  >
                    {bridgeMsg.text}
                  </div>
                ) : null}

                <p className="text-[11px] text-muted-foreground">
                  instance_id: <code className="font-mono">{bridgeStatus?.instanceId || '…'}</code>
                </p>
              </div>
            </Section>
          )}

          {active === 'appearance' && (
            <>
              <Section title="Тема">
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {THEMES.map((t) => {
                    const p = THEME_PREVIEW[t.id]
                    const activeT = theme === t.id
                    return (
                      <button
                        key={t.id}
                        onClick={() => post({ type: 'setTheme', payload: { theme: t.id } })}
                        className={`flex flex-col items-stretch gap-1.5 border-2 p-1.5 transition-all ${
                          activeT
                            ? 'border-foreground bg-pixel-magenta/10 shadow-[3px_3px_0_0_var(--foreground)]'
                            : 'border-border hover:border-pixel-magenta'
                        }`}
                      >
                        <div
                          className="grid h-12 grid-cols-2 gap-1 border border-border p-1"
                          style={{ background: p.bg }}
                        >
                          {p.dots.map((d, i) => (
                            <span key={i} style={{ background: d }} className="size-3 self-center" />
                          ))}
                        </div>
                        <span className="text-center font-mono text-[11px]">{t.label}</span>
                      </button>
                    )
                  })}
                </div>
              </Section>

              <Section title="Своя тема (применяется при выборе «Своя»)">
                <div className="grid grid-cols-2 gap-2">
                  {CUSTOM_THEME_FIELDS.map((f) => {
                    const v = settings.customTheme[f.key] || f.default
                    return (
                      <label key={f.key} className="flex items-center gap-2 text-xs">
                        <input
                          type="color"
                          value={v}
                          onChange={(e) =>
                            update({ customTheme: { ...settings.customTheme, [f.key]: e.target.value } })
                          }
                          className="h-7 w-9 cursor-pointer border border-border bg-background"
                        />
                        <input
                          value={v}
                          onChange={(e) =>
                            update({ customTheme: { ...settings.customTheme, [f.key]: e.target.value } })
                          }
                          className="w-24 border border-input bg-background px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-pixel-magenta"
                        />
                        <span className="truncate text-[11px] text-muted-foreground">{f.label}</span>
                      </label>
                    )
                  })}
                  <button
                    onClick={() => update({ customTheme: {} })}
                    className="col-span-2 border border-border bg-background px-2 py-1 text-[11px] hover:border-pixel-coral hover:text-pixel-coral"
                  >
                    Сбросить
                  </button>
                </div>
              </Section>

              <Section title="Масштаб интерфейса">
                <div className="flex flex-wrap gap-2">
                  {[0.85, 1, 1.15, 1.3].map((s) => {
                    const a = Math.abs(settings.fontScale - s) < 0.01
                    return (
                      <button
                        key={s}
                        onClick={() => update({ fontScale: s })}
                        className={`border-2 px-3 py-1 text-xs font-mono ${
                          a
                            ? 'border-foreground bg-pixel-cyan text-black shadow-[2px_2px_0_0_var(--foreground)]'
                            : 'border-border bg-background hover:border-pixel-magenta'
                        }`}
                      >
                        {Math.round(s * 100)}%
                      </button>
                    )
                  })}
                </div>
              </Section>

              <Section title="Анимации">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.companionEnabled}
                    onChange={(e) => update({ companionEnabled: e.target.checked })}
                    className="size-4 accent-pixel-magenta"
                  />
                  Анимировать аватара состояний (думает / печатает / ждёт)
                </label>
              </Section>
            </>
          )}

          {active === 'behavior' && (
            <>
              <Section title="Системный промпт (добавляется к default)">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {SYSTEM_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => update({ systemPrompt: p.text })}
                      className="border border-border bg-background px-2 py-0.5 font-mono text-[11px] hover:border-pixel-magenta"
                      title={p.text}
                    >
                      {p.name}
                    </button>
                  ))}
                  {settings.systemPrompt && (
                    <button
                      onClick={() => update({ systemPrompt: '' })}
                      className="border border-border bg-background px-2 py-0.5 font-mono text-[11px] hover:border-pixel-coral hover:text-pixel-coral"
                    >
                      очистить
                    </button>
                  )}
                </div>
                <textarea
                  rows={4}
                  value={settings.systemPrompt}
                  onChange={(e) => update({ systemPrompt: e.target.value })}
                  className="w-full resize-y border-2 border-input bg-background px-3 py-2 text-sm outline-none focus:border-pixel-magenta"
                />
              </Section>

              <Section title="Лимит итераций (max turns, 0 = без лимита)">
                <input
                  type="number"
                  min={0}
                  value={settings.maxTurns}
                  onChange={(e) => update({ maxTurns: Number(e.target.value) || 0 })}
                  className="w-32 border-2 border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-pixel-magenta"
                />
              </Section>

              <Section title="Авто-контекст в каждом запросе">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.autoContext}
                    onChange={(e) => update({ autoContext: e.target.checked })}
                    className="size-4 accent-pixel-magenta"
                  />
                  Прикреплять открытые табы, выделение и <code className="font-mono">git diff --stat</code>
                </label>
              </Section>

              <Section title="Speculative Haiku">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.speculativeHaiku}
                    onChange={(e) => update({ speculativeHaiku: e.target.checked })}
                    className="size-4 accent-pixel-magenta"
                  />
                  Параллельно с Opus пускать Haiku — быстрый превью-ответ
                </label>
              </Section>

              <Section title="Pomodoro">
                <div className="flex items-center gap-2 text-xs">
                  <span>Длина (мин), 0 = выкл:</span>
                  <input
                    type="number"
                    min={0}
                    max={180}
                    value={settings.pomodoroMinutes}
                    onChange={(e) => update({ pomodoroMinutes: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-20 border-2 border-input bg-background px-2 py-1 outline-none focus:border-pixel-magenta"
                  />
                </div>
              </Section>

              <Section title="Уведомления">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.notifyOnDone}
                    onChange={(e) => update({ notifyOnDone: e.target.checked })}
                    className="size-4 accent-pixel-magenta"
                  />
                  Показывать toast «ответ готов», когда окно в фоне (запрос &gt; 8 сек)
                </label>
              </Section>
            </>
          )}

          {active === 'security' && (
            <>
              <Section title="Режим работы агента">
                <div className="grid gap-2">
                  {(
                    [
                      {
                        id: 'asking',
                        label: 'Ручной',
                        emoji: '🛡',
                        hint: 'Каждая правка файла и каждая Bash-команда — через подтверждение. Безопаснее всего.',
                      },
                      {
                        id: 'edits',
                        label: 'Принимать правки',
                        emoji: '✏️',
                        hint: 'Edit / Write / MultiEdit применяются без вопроса. Bash-команды всё ещё спрашивают. Удобно для рутинного рефакторинга.',
                      },
                      {
                        id: 'all',
                        label: 'Авто-агент',
                        emoji: '🤖',
                        hint: 'Полная автономия: правки, Bash, всё подряд без подтверждений. Включай для длинных задач — например, /loop pnpm test до зелёного.',
                      },
                    ] as const
                  ).map((m) => {
                    const a = settings.autoApprove === m.id
                    return (
                      <button
                        key={m.id}
                        onClick={() => update({ autoApprove: m.id })}
                        className={`flex items-start gap-3 border-2 px-3 py-2 text-left transition-all ${
                          a
                            ? 'border-foreground bg-pixel-magenta/15 shadow-[2px_2px_0_0_var(--foreground)]'
                            : 'border-border bg-background hover:border-pixel-magenta'
                        }`}
                      >
                        <span className="text-lg leading-none">{m.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            {m.label}
                            {a && (
                              <span className="font-mono text-[10px] uppercase text-pixel-magenta">
                                · выбрано
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                            {m.hint}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </Section>

              <Section title="Path-allowlist для Edit/Write (globs через пробел)">
                <textarea
                  rows={2}
                  value={settings.allowedEditPaths}
                  onChange={(e) => update({ allowedEditPaths: e.target.value })}
                  placeholder="src/** app/**/*.ts"
                  className="w-full resize-y border-2 border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:border-pixel-magenta"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Пусто = всё разрешено.</p>
              </Section>

              <Section title="Запрещённые Bash-паттерны (regex или substring через пробел)">
                <textarea
                  rows={2}
                  value={settings.customDisallowBash}
                  onChange={(e) => update({ customDisallowBash: e.target.value })}
                  placeholder="rm -rf  git push --force"
                  className="w-full resize-y border-2 border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:border-pixel-magenta"
                />
              </Section>

              <Section title="Snapshot перед правкой">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.snapshotBeforeWrite}
                    onChange={(e) => update({ snapshotBeforeWrite: e.target.checked })}
                    className="size-4 accent-pixel-magenta"
                  />
                  Делать <code className="font-mono">git stash</code> перед каждой Edit/Write
                </label>
              </Section>

              <Section title="Audit log">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.auditLog}
                    onChange={(e) => update({ auditLog: e.target.checked })}
                    className="size-4 accent-pixel-magenta"
                  />
                  Писать журнал в <code className="font-mono">.cockpit/audit.log</code>
                </label>
              </Section>

              <Section title="Бюджеты">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span>День $</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={settings.dailyBudget}
                    onChange={(e) => update({ dailyBudget: Number(e.target.value) || 0 })}
                    className="w-24 border-2 border-input bg-background px-2 py-1 outline-none focus:border-pixel-magenta"
                  />
                  <span>· Сессия $</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={settings.sessionBudget}
                    onChange={(e) => update({ sessionBudget: Number(e.target.value) || 0 })}
                    className="w-24 border-2 border-input bg-background px-2 py-1 outline-none focus:border-pixel-magenta"
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">0 = без лимита.</p>
              </Section>
            </>
          )}

          {active === 'tools' && (
            <>
              <Section title="Web-инструменты">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.webSearch}
                    onChange={(e) => update({ webSearch: e.target.checked })}
                    className="size-4 accent-pixel-magenta"
                  />
                  WebSearch — поиск в интернете
                </label>
                <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.webFetch}
                    onChange={(e) => update({ webFetch: e.target.checked })}
                    className="size-4 accent-pixel-magenta"
                  />
                  WebFetch — загрузка страниц
                </label>
              </Section>

              <Section title="Inline-completions в редакторе (Tab)">
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.completionsEnabled}
                    onChange={(e) => update({ completionsEnabled: e.target.checked })}
                    className="size-4 accent-pixel-magenta"
                  />
                  Включить (модель haiku, через подписку)
                </label>
                <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.completionsAutoTrigger}
                    disabled={!settings.completionsEnabled}
                    onChange={(e) => update({ completionsAutoTrigger: e.target.checked })}
                    className="size-4 accent-pixel-magenta disabled:opacity-40"
                  />
                  Авто-триггер при наборе (иначе только через палитру)
                </label>
              </Section>
            </>
          )}

          {active === 'memory' && (
            <Section title="Память воркспейса (CLAUDE.md)">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => post({ type: 'openWorkspaceMemory' })}
                  className="border-2 border-foreground bg-background px-3 py-1.5 text-xs font-semibold shadow-[2px_2px_0_0_var(--foreground)] hover:bg-pixel-magenta/15"
                >
                  Открыть / создать CLAUDE.md
                </button>
                <span className="text-xs text-muted-foreground">
                  Учитывается ассистентом для этого проекта.
                </span>
              </div>
            </Section>
          )}

          {active === 'mcp' && (
            <Section title="MCP-серверы">
              <McpEditor
                servers={parseMcpServers(settings.mcpServers)}
                onChange={(next) => update({ mcpServers: serializeMcpServers(next) })}
              />
            </Section>
          )}

          {active === 'prompts' && (
            <Section title="Шаблоны промптов (.cockpit/prompts/*.md)">
              <PromptLibrary
                prompts={prompts}
                onLoad={() => post({ type: 'listPrompts' })}
                onSave={(name, content) =>
                  post({ type: 'savePrompt', payload: { name, content } })
                }
                onDelete={(name) => post({ type: 'deletePrompt', payload: { name } })}
              />
            </Section>
          )}

          {active === 'limits' && (
            <>
              <Section title="Лимиты подписки Claude">
                {Object.keys(limits).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Нет данных — отправь хотя бы один запрос в Cockpit.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {RATE_LIMIT_ORDER.filter(({ key }) => limits[key]).map(({ key, label }) => {
                      const info = limits[key]
                      const util = Math.max(0, Math.min(1, info.utilization ?? 0))
                      const pct = Math.round(util * 100)
                      const danger =
                        info.status === 'rejected' || util > 0.9
                          ? 'bg-pixel-coral'
                          : info.status === 'allowed_warning' || util > 0.7
                            ? 'bg-pixel-gold'
                            : 'bg-pixel-lime'
                      return (
                        <div key={key} className="space-y-1">
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="font-semibold">{label}</span>
                            <span className="font-mono text-muted-foreground">
                              {pct}% · {timeUntil(info.resetsAt)}
                            </span>
                          </div>
                          <div className="h-2 w-full border border-border bg-background">
                            <div className={`h-full ${danger}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>

              <Section title="Usage / стоимость">
                <div className="grid gap-1.5 font-mono text-xs">
                  <Row label="Сессия">
                    <span>
                      <b className="text-pixel-gold">${sessionCost.toFixed(4)}</b>
                      {' · '}↓<b className="text-pixel-cyan">{compactNum(sessionInput)}</b>
                      {' / '}↑<b className="text-pixel-cyan">{compactNum(sessionOutput)}</b>
                      {sessionCache > 0 && (
                        <>
                          {' · кэш '}
                          <b className="text-pixel-lime">{compactNum(sessionCache)}</b>
                        </>
                      )}
                    </span>
                  </Row>
                  <Row label="Сегодня">
                    <b className="text-pixel-gold">${costToday.toFixed(4)}</b>
                  </Row>
                  <Row label="Всего">
                    <b className="text-pixel-gold">${costTotal.toFixed(4)}</b>
                  </Row>
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => {
                      if (confirm('Сбросить счётчики стоимости?')) post({ type: 'resetCost' })
                    }}
                    className="border-2 border-border bg-background px-2 py-1 text-xs hover:border-pixel-coral hover:text-pixel-coral"
                  >
                    сбросить
                  </button>
                </div>
              </Section>

              <Section title="Subagents (текущей сессии)">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => post({ type: 'listSubagents' })}
                    className="border-2 border-border bg-background px-2 py-1 text-xs hover:border-pixel-magenta"
                  >
                    Обновить
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {subagents.length === 0 ? 'не загружено' : `${subagents.length} шт`}
                  </span>
                </div>
                {subagents.length > 0 && (
                  <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
                    {subagents.map((n) => (
                      <li key={n} className="border border-border bg-background px-2 py-1">
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}

          {active === 'achievements' && (
            <Section title="Достижения">
              <ul className="grid gap-2 sm:grid-cols-2">
                {ACHIEVEMENTS_META.map((a) => {
                  const earned = achievements.includes(a.id)
                  return (
                    <li
                      key={a.id}
                      className={`flex items-start gap-3 border-2 px-3 py-2 ${
                        earned
                          ? 'border-pixel-gold/70 bg-pixel-gold/10'
                          : 'border-border bg-background/50 opacity-60'
                      }`}
                    >
                      <span className="text-lg leading-none">{earned ? a.emoji : '🔒'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{a.label}</div>
                        <div className="text-[11px] text-muted-foreground">{a.hint}</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Section>
          )}
        </div>
      </main>
    </div>
    </LocaleContext.Provider>
  )
}

function LocaleSelector({
  value,
  onChange,
}: {
  value: 'auto' | 'ru' | 'en'
  onChange: (v: 'auto' | 'ru' | 'en') => void
}) {
  const t = useT()
  const opts: { v: 'auto' | 'ru' | 'en'; label: string }[] = [
    { v: 'auto', label: t('settings.account.localeAuto') },
    { v: 'ru', label: t('settings.account.localeRu') },
    { v: 'en', label: t('settings.account.localeEn') },
  ]
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {t('settings.account.locale')}:
      </span>
      <div className="flex gap-1">
        {opts.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`border-2 border-foreground px-2 py-1 text-xs font-semibold shadow-[2px_2px_0_0_var(--foreground)] ${
              value === o.v
                ? 'bg-pixel-magenta text-white'
                : 'bg-background hover:bg-pixel-magenta/15'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-pixel-magenta">
        {title}
      </h2>
      <div className="border-2 border-border bg-card/60 p-3">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function PromptLibrary({
  prompts,
  onLoad,
  onSave,
  onDelete,
}: {
  prompts: PromptTemplate[]
  onLoad: () => void
  onSave: (name: string, content: string) => void
  onDelete: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onLoad}
          className="border-2 border-border bg-background px-2 py-1 text-xs hover:border-pixel-magenta"
        >
          Обновить
        </button>
        <span className="text-xs text-muted-foreground">
          {prompts.length === 0 ? 'пока нет шаблонов' : `${prompts.length} шт`}
        </span>
      </div>
      {prompts.map((p) => (
        <details key={p.name} className="border border-border bg-background">
          <summary className="cursor-pointer px-2 py-1 text-xs">
            <span className="font-mono text-pixel-cyan">{p.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                if (confirm(`Удалить «${p.name}»?`)) onDelete(p.name)
              }}
              className="float-right border border-border bg-card px-1.5 text-[10px] hover:border-pixel-coral hover:text-pixel-coral"
            >
              удалить
            </button>
          </summary>
          <pre className="max-h-40 overflow-auto border-t border-border bg-background/60 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap">
            {p.content}
          </pre>
        </details>
      ))}
      <div className="space-y-1 border-2 border-dashed border-border p-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Имя шаблона"
          className="w-full border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus:border-pixel-magenta"
        />
        <textarea
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Текст шаблона (markdown)"
          className="w-full resize-y border border-input bg-background px-2 py-1 text-xs outline-none focus:border-pixel-magenta"
        />
        <div className="flex justify-end">
          <button
            onClick={() => {
              if (!name.trim() || !content.trim()) return
              onSave(name.trim(), content)
              setName('')
              setContent('')
            }}
            disabled={!name.trim() || !content.trim()}
            className="border-2 border-foreground bg-pixel-lime px-3 py-1 text-xs font-semibold text-black shadow-[2px_2px_0_0_var(--foreground)] disabled:opacity-40"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

function McpEditor({
  servers,
  onChange,
}: {
  servers: McpServer[]
  onChange: (next: McpServer[]) => void
}) {
  const update = (i: number, patch: Partial<McpServer>) => {
    onChange(servers.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  const remove = (i: number) => onChange(servers.filter((_, idx) => idx !== i))
  const addStdio = () =>
    onChange([
      ...servers,
      { name: `server-${servers.length + 1}`, type: 'stdio', command: '', args: [] },
    ])
  const addHttp = () =>
    onChange([...servers, { name: `server-${servers.length + 1}`, type: 'http', url: '' }])
  return (
    <div className="space-y-2">
      {servers.length === 0 && (
        <div className="border border-dashed border-border bg-background/50 px-3 py-3 text-center text-xs text-muted-foreground">
          Нет настроенных MCP-серверов
        </div>
      )}
      {servers.map((s, i) => (
        <div key={i} className="border-2 border-border bg-background/60 p-2.5">
          <div className="flex items-center gap-2">
            <input
              value={s.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="имя"
              className="w-32 border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus:border-pixel-magenta"
            />
            <select
              value={s.type}
              onChange={(e) => update(i, { type: e.target.value as 'stdio' | 'http' })}
              className="border border-input bg-background px-1.5 py-1 text-xs font-mono outline-none"
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
            <button
              onClick={() => remove(i)}
              className="ml-auto border border-border bg-background px-2 py-1 text-xs hover:border-pixel-coral hover:text-pixel-coral"
            >
              ×
            </button>
          </div>
          {s.type === 'stdio' ? (
            <div className="mt-2 grid gap-1.5">
              <input
                value={s.command ?? ''}
                onChange={(e) => update(i, { command: e.target.value })}
                placeholder="команда (npx / node / path)"
                className="border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus:border-pixel-magenta"
              />
              <input
                value={(s.args ?? []).join(' ')}
                onChange={(e) => update(i, { args: e.target.value.split(/\s+/).filter(Boolean) })}
                placeholder="аргументы через пробел"
                className="border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus:border-pixel-magenta"
              />
            </div>
          ) : (
            <input
              value={s.url ?? ''}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://… (SSE / HTTP endpoint)"
              className="mt-2 w-full border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus:border-pixel-magenta"
            />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button
          onClick={addStdio}
          className="border-2 border-border bg-background px-2 py-1 text-xs hover:border-pixel-magenta"
        >
          + stdio
        </button>
        <button
          onClick={addHttp}
          className="border-2 border-border bg-background px-2 py-1 text-xs hover:border-pixel-magenta"
        >
          + http
        </button>
      </div>
    </div>
  )
}
