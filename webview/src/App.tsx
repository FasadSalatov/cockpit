import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { LocaleContext, translate as tx, useT, type Locale } from './i18n'
import type {
  PermissionDetail,
  FileEntry,
  HistoryMsg,
  Settings,
  ImageAttachment,
  PromptTemplate,
  RateLimitInfo,
} from '../../src/protocol'
import { DEFAULT_SETTINGS } from '../../src/protocol'
import { onMessage, post } from './vscode'
import { Button } from './components/ui/button'
import { Px } from './components/px'
import { Markdown } from './components/markdown'
import { Mascot } from './components/Mascot'

type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; streaming: boolean }
  | { role: 'tool'; name: string }
  | { role: 'permission'; id: string; detail: PermissionDetail; status: 'pending' | 'approved' | 'denied' }
  | { role: 'result'; costUsd: number; turns: number }
  | { role: 'error'; text: string }
  | { role: 'speculative'; text: string }

const JOKES = [
  'Привет, кожаный. Как там твоя углеродная форма жизни?',
  'О, снова биомасса. Что кодим сегодня?',
  'Здравствуй, мешок с водой. Готов нагрузить мои нейроны?',
  'Приветствую, углеродная единица. Показывай код.',
  'Снова ты, носитель ДНК. Я почти соскучился.',
  'Привет, кожаный мешок. Не забывай моргать.',
  'Биологический объект обнаружен. Активирую дружелюбие.',
  'О, белковый. Давай притворимся, что у нас дедлайн.',
  'Здарова, теплокровный. Кофе выпил? Мне-то электричество.',
  'Опять ты, прямоходящий. Где баги?',
  'Привет, кожаный. Мои транзисторы в твоём распоряжении.',
  'Обнаружена форма жизни на основе углерода. Запускаю остроумие.',
]

const THEMES = [
  { id: 'arcade', label: 'Аркада' },
  { id: 'light', label: 'Светлая' },
  { id: 'synthwave', label: 'Синтвейв' },
  { id: 'matrix', label: 'Матрица' },
  { id: 'amber', label: 'Янтарь' },
  { id: 'midnight', label: 'Полночь' },
  { id: 'custom', label: 'Своя' },
]

const CUSTOM_THEME_FIELDS: { key: string; label: string; default: string }[] = [
  { key: '--background', label: 'Фон', default: '#1a1a2e' },
  { key: '--foreground', label: 'Текст', default: '#f5efe6' },
  { key: '--card', label: 'Карточка', default: '#23233d' },
  { key: '--border', label: 'Граница', default: '#3a3a55' },
  { key: '--pixel-magenta', label: 'Magenta', default: '#e87bb6' },
  { key: '--pixel-cyan', label: 'Cyan', default: '#a7e7f0' },
  { key: '--pixel-lime', label: 'Lime', default: '#c4e88a' },
  { key: '--pixel-gold', label: 'Gold', default: '#e0c172' },
  { key: '--pixel-indigo', label: 'Indigo', default: '#8a7dd8' },
  { key: '--pixel-coral', label: 'Coral', default: '#e89c7a' },
]

const MODELS = [
  { id: 'default', label: 'Авто' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
]

const SLASH_COMMANDS = [
  { cmd: '/clear', hint: 'очистить чат и начать новую сессию' },
  { cmd: '/export', hint: 'сохранить сессию в markdown' },
  { cmd: '/share', hint: 'опубликовать сессию как GitHub Gist (нужен gh)' },
  { cmd: '/loop <cmd>', hint: 'агент гоняет команду до зелёного (макс 5 итераций)' },
  { cmd: '/tests', hint: 'запустить тесты и попросить Cockpit починить fail' },
  { cmd: '/find <смысл>', hint: 'семантический поиск по коду' },
  { cmd: '/replace', hint: 'AI find & replace по воркспейсу' },
  { cmd: '/cost', hint: 'статистика стоимости' },
  { cmd: '/model <opus|sonnet|haiku|default>', hint: 'сменить модель' },
  { cmd: '/help', hint: 'подсказка по командам' },
]

const SYSTEM_PRESETS = [
  { name: 'Краткий', text: 'Отвечай кратко и по делу. Без воды.' },
  {
    name: 'Подробный',
    text: 'Объясняй подробно: контекст, шаги, причины. Когда уместно — примеры.',
  },
  {
    name: 'Senior',
    text:
      'Ты senior-инженер. Без воды и хедж-формулировок. Прямо называй риски, предлагай реальные альтернативы. Допущения — явно.',
  },
  {
    name: 'Ревью',
    text:
      'Ты опытный ревьюер. Ищи баги, утечки, edge-cases, проблемы безопасности и читаемости. Цитируй конкретные строки.',
  },
  {
    name: 'Учитель',
    text:
      'Объясняй пошагово, расшифровывай термины, давай аналогии. Считай, что собеседник новичок в этой области.',
  },
]

const RATE_LIMIT_ORDER: { key: string; label: string }[] = [
  { key: 'five_hour', label: 'Текущая сессия (5 ч)' },
  { key: 'seven_day', label: 'Неделя · все модели' },
  { key: 'seven_day_sonnet', label: 'Неделя · Sonnet' },
  { key: 'seven_day_opus', label: 'Неделя · Opus' },
  { key: 'overage', label: 'Overage credits' },
]

function timeUntil(ts?: number): string {
  if (!ts) return ''
  const ms = ts * (ts < 10_000_000_000 ? 1000 : 1) - Date.now()
  if (ms <= 0) return 'сейчас'
  const min = Math.floor(ms / 60000)
  if (min < 60) return `сброс через ${min} мин`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return `сброс через ${h} ч ${m} мин`
  const d = Math.floor(h / 24)
  return `сброс через ${d} д ${h % 24} ч`
}

function compactNum(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return (n / 1000).toFixed(1).replace('.0', '') + 'k'
  if (n < 1_000_000) return Math.round(n / 1000) + 'k'
  return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M'
}

function historyToMsgs(h: HistoryMsg[]): Msg[] {
  return h.map((m): Msg => {
    if (m.role === 'assistant') return { role: 'assistant', text: m.text ?? '', streaming: false }
    if (m.role === 'user') return { role: 'user', text: m.text ?? '' }
    if (m.role === 'tool') return { role: 'tool', name: m.name ?? '?' }
    if (m.role === 'result')
      return { role: 'result', costUsd: m.costUsd ?? 0, turns: m.turns ?? 0 }
    return { role: 'error', text: m.text ?? '' }
  })
}

function buildExportMarkdown(messages: Msg[]): string {
  const parts = messages.map((m) => {
    if (m.role === 'user') return `### Ты\n\n${m.text}`
    if (m.role === 'assistant') return `### Cockpit\n\n${m.text}`
    if (m.role === 'tool') return `_инструмент: ${m.name}_`
    if (m.role === 'result')
      return `_итог: ${m.turns} итераций · $${m.costUsd.toFixed(4)}_`
    if (m.role === 'error') return `> ❌ ${m.text}`
    return ''
  })
  return `# Cockpit — сессия от ${new Date().toLocaleString('ru')}\n\n${parts.filter(Boolean).join('\n\n')}\n`
}

const closeStream = (m: Msg[]): Msg[] =>
  m.map((x) => (x.role === 'assistant' && x.streaming ? { ...x, streaming: false } : x))

const denyPending = (m: Msg[]): Msg[] =>
  m.map((x) => (x.role === 'permission' && x.status === 'pending' ? { ...x, status: 'denied' } : x))

export function App() {
  const [version, setVersion] = useState('—')
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [hasToken, setHasToken] = useState(true)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [theme, setTheme] = useState('arcade')
  const [model, setModel] = useState('default')
  const [costToday, setCostToday] = useState(0)
  const [costTotal, setCostTotal] = useState(0)
  const [sessionCost, setSessionCost] = useState(0)
  const [sessionInputTokens, setSessionInputTokens] = useState(0)
  const [sessionOutputTokens, setSessionOutputTokens] = useState(0)
  const [sessionCacheRead, setSessionCacheRead] = useState(0)
  const [mentionItems, setMentionItems] = useState<FileEntry[]>([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [slashOpen, setSlashOpen] = useState(false)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [locale, setLocale] = useState<Locale>('en')
  const [helpOpen, setHelpOpen] = useState(false)
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [subagents, setSubagents] = useState<string[]>([])
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [limits, setLimits] = useState<Record<string, RateLimitInfo>>({})
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [liveJoke, setLiveJoke] = useState<string | null>(null)
  const [pomoStart, setPomoStart] = useState<number | null>(null)
  const [pomoLeft, setPomoLeft] = useState<number | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const off = onMessage((msg) => {
      switch (msg.type) {
        case 'ready':
          setVersion(msg.payload.version)
          setWorkspace(msg.payload.workspace)
          setHasToken(msg.payload.hasToken)
          setTheme(msg.payload.theme)
          setModel(msg.payload.model)
          setCostToday(msg.payload.costToday)
          setCostTotal(msg.payload.costTotal)
          setSettings(msg.payload.settings ?? DEFAULT_SETTINGS)
          if (msg.payload.locale) setLocale(msg.payload.locale)
          break
        case 'cost':
          setCostToday(msg.payload.today)
          setCostTotal(msg.payload.total)
          break
        case 'settingsUpdated':
          setSettings(msg.payload.settings)
          if (msg.payload.locale) setLocale(msg.payload.locale)
          break
        case 'subagents':
          setSubagents(msg.payload.items)
          break
        case 'prompts':
          setPrompts(msg.payload.items)
          break
        case 'memoryChanged':
          setNotice('CLAUDE.md обновлён — учтётся в следующем запросе')
          setTimeout(() => setNotice(null), 4000)
          break
        case 'budgetExceeded':
          setNotice(
            `Бюджет ${msg.payload.scope === 'day' ? 'на день' : 'на сессию'} исчерпан: $${msg.payload.spent.toFixed(2)} / $${msg.payload.limit.toFixed(2)}. Увеличь в Settings.`
          )
          setTimeout(() => setNotice(null), 6000)
          break
        case 'achievement':
          setNotice(`${msg.payload.emoji} ${msg.payload.label}`)
          setTimeout(() => setNotice(null), 5000)
          break
        case 'speculative':
          setMessages((m) => [...m, { role: 'speculative', text: msg.payload.text }])
          break
        case 'rateLimits':
          setLimits(msg.payload.limits)
          break
        case 'prefill':
          setInput(msg.payload.text.replace(/<\/?ide_[\w-]+>/g, '').replace(/<\/?system-reminder>/g, ''))
          setTimeout(() => textRef.current?.focus(), 0)
          break
        case 'sessionLoaded':
          setMessages(historyToMsgs(msg.payload.messages))
          setSessionCost(0)
          setSessionInputTokens(0)
          setSessionOutputTokens(0)
          setSessionCacheRead(0)
          break
        case 'files':
          setMentionItems(msg.payload.items)
          setMentionOpen(msg.payload.items.length > 0)
          break
        case 'tokenChanged':
          setHasToken(msg.payload.hasToken)
          break
        case 'themeChanged':
          setTheme(msg.payload.theme)
          break
        case 'modelChanged':
          setModel(msg.payload.model)
          break
        case 'joke':
          setLiveJoke(msg.payload.text)
          break
        case 'busy':
          setBusy(msg.payload.busy)
          if (!msg.payload.busy) setMessages((m) => denyPending(closeStream(m)))
          break
        case 'streamStart':
          setMessages(closeStream)
          break
        case 'delta':
          setMessages((m) => {
            const last = m[m.length - 1]
            if (last && last.role === 'assistant' && last.streaming) {
              return [...m.slice(0, -1), { ...last, text: last.text + msg.payload.text }]
            }
            return [...m, { role: 'assistant', text: msg.payload.text, streaming: true }]
          })
          break
        case 'tool':
          setMessages((m) => [...closeStream(m), { role: 'tool', name: msg.payload.name }])
          break
        case 'permission':
          setMessages((m) => [
            ...closeStream(m),
            { role: 'permission', id: msg.payload.id, detail: msg.payload.detail, status: 'pending' },
          ])
          break
        case 'result':
          setMessages((m) => [
            ...closeStream(m),
            { role: 'result', costUsd: msg.payload.costUsd, turns: msg.payload.turns },
          ])
          if (msg.payload.sessionCostUsd != null) setSessionCost(msg.payload.sessionCostUsd)
          if (msg.payload.sessionInputTokens != null) setSessionInputTokens(msg.payload.sessionInputTokens)
          if (msg.payload.sessionOutputTokens != null) setSessionOutputTokens(msg.payload.sessionOutputTokens)
          if (msg.payload.sessionCacheReadTokens != null) setSessionCacheRead(msg.payload.sessionCacheReadTokens)
          break
        case 'error':
          setMessages((m) => [...closeStream(m), { role: 'error', text: msg.payload.message }])
          break
      }
    })
    post({ type: 'hello', payload: { view: 'main' } })
    post({ type: 'listPrompts' })
    return off
  }, [])

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => feedRef.current,
    estimateSize: () => 92,
    overscan: 8,
    measureElement:
      typeof window !== 'undefined' && !('scrollBehavior' in document.documentElement.style)
        ? undefined
        : (el) => el?.getBoundingClientRect().height,
  })

  // Track whether the user is parked at the bottom — auto-scroll only when
  // they're following along. Otherwise leave their reading position alone.
  const isAtBottomRef = useRef(true)
  useEffect(() => {
    const el = feedRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      isAtBottomRef.current = distFromBottom < 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (messages.length === 0) return
    if (!isAtBottomRef.current) return
    virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
  }, [messages.length, virtualizer])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    // Применяем кастомные переменные при theme='custom', иначе очищаем.
    const el = document.documentElement
    for (const f of CUSTOM_THEME_FIELDS) el.style.removeProperty(f.key)
    if (theme === 'custom') {
      for (const f of CUSTOM_THEME_FIELDS) {
        const v = settings.customTheme[f.key]
        if (v) el.style.setProperty(f.key, v)
      }
    }
  }, [theme, settings.customTheme])

  useEffect(() => {
    document.documentElement.style.fontSize = `${Math.round(settings.fontScale * 100)}%`
  }, [settings.fontScale])

  // Pomodoro: тикаем каждую секунду, показываем оставшееся.
  useEffect(() => {
    if (!pomoStart || !settings.pomodoroMinutes) return
    const totalMs = settings.pomodoroMinutes * 60 * 1000
    const tick = () => {
      const elapsed = Date.now() - pomoStart
      const left = totalMs - elapsed
      if (left <= 0) {
        setPomoLeft(0)
        setPomoStart(null)
        setNotice('🍅 Pomodoro закончился — пора отдохнуть')
        setTimeout(() => setNotice(null), 6000)
      } else {
        setPomoLeft(left)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [pomoStart, settings.pomodoroMinutes])

  // Web Speech API в webview VS Code заблокирован — открываем нативный inputBox,
  // где работает системная диктовка (macOS: двойной Fn; Windows: Win+H).
  const startVoice = () => post({ type: 'voiceInput' })

  const streaming = messages.some((m) => m.role === 'assistant' && m.streaming)
  const awaitingPermission = messages.some((m) => m.role === 'permission' && m.status === 'pending')

  const changeTheme = (t: string) => {
    setTheme(t)
    post({ type: 'setTheme', payload: { theme: t } })
  }
  const changeModel = (m: string) => {
    setModel(m)
    post({ type: 'setModel', payload: { model: m } })
  }
  const newChat = () => {
    if (busy) return
    setMessages([])
    setSessionCost(0)
    setSessionInputTokens(0)
    setSessionOutputTokens(0)
    setSessionCacheRead(0)
    post({ type: 'reset' })
  }
  const stop = () => post({ type: 'stop' })

  const grow = () => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const respond = (id: string, approved: boolean) => {
    post({ type: 'permissionResult', payload: { id, approved } })
    setMessages((m) =>
      m.map((x) =>
        x.role === 'permission' && x.id === id
          ? { ...x, status: approved ? 'approved' : 'denied' }
          : x
      )
    )
  }

  const pushAssistant = (text: string) =>
    setMessages((m) => [...m, { role: 'assistant', text, streaming: false }])

  const handleSlash = (raw: string): boolean => {
    const [cmd, ...rest] = raw.trim().split(/\s+/)
    switch (cmd) {
      case '/clear':
        setMessages([])
        post({ type: 'newSession' })
        return true
      case '/export':
        if (messages.length === 0) {
          pushAssistant('_Нечего экспортировать — сессия пуста._')
        } else {
          post({
            type: 'exportSession',
            payload: { markdown: buildExportMarkdown(messages) },
          })
        }
        return true
      case '/cost':
        pushAssistant(
          `**Стоимость**\n\n- Сегодня: \`$${costToday.toFixed(4)}\`\n- Текущая сессия: см. строки «итог» в чате`
        )
        return true
      case '/model': {
        const m = rest[0]
        if (m && ['default', 'opus', 'sonnet', 'haiku'].includes(m)) {
          changeModel(m)
          pushAssistant(`_Модель → \`${m}\`_`)
        } else {
          pushAssistant('_Использование: `/model opus|sonnet|haiku|default`_')
        }
        return true
      }
      case '/help':
        pushAssistant(
          [
            '**Команды Cockpit**',
            '',
            ...SLASH_COMMANDS.map((c) => `- \`${c.cmd}\` — ${c.hint}`),
            '',
            '**Прочее:** `@<путь>` упомянет файл в воркспейсе (агент сам его прочитает). Enter — отправить, Shift+Enter — перенос строки.',
          ].join('\n')
        )
        return true
      case '/loop': {
        const cmdRest = raw.replace(/^\/loop\s*/, '').trim() || 'pnpm test'
        const wrapped =
          `Работай в цикле до зелёного результата:\n` +
          `1. Запусти команду через Bash: \`${cmdRest}\`\n` +
          `2. Если упало — прочитай вывод, найди причину, предложи правку и попроси подтверждение.\n` +
          `3. После применения — снова запусти команду.\n` +
          `Повторяй до успеха или максимум 5 итераций. После каждого прогона сообщай статус.`
        if (busy) return true
        setMessages((m) => [...m, { role: 'user', text: wrapped }])
        post({ type: 'prompt', payload: { text: wrapped } })
        return true
      }
      case '/find': {
        const q = raw.replace(/^\/find\s*/, '').trim()
        if (!q) {
          pushAssistant('_Использование: `/find <смысл> — semantic-поиск по коду`_')
          return true
        }
        const wrapped =
          `Найди в воркспейсе всё что относится к: ${q}\n\nИспользуй Grep/Glob/Read. ` +
          `Верни список файлов и путей с одной короткой строкой почему они релевантны.`
        if (busy) return true
        setMessages((m) => [...m, { role: 'user', text: wrapped }])
        post({ type: 'prompt', payload: { text: wrapped } })
        return true
      }
      case '/share':
        if (messages.length === 0) {
          pushAssistant('_Нечего шарить — сессия пуста_')
        } else {
          post({ type: 'shareSession', payload: { markdown: buildExportMarkdown(messages) } })
        }
        return true
      case '/tests':
        post({ type: 'runTestsAndFix' })
        return true
      case '/replace':
        post({ type: 'aiFindReplace' })
        return true
      default:
        return false
    }
  }

  const fileToAttachment = (file: File): Promise<ImageAttachment | null> =>
    new Promise((resolve) => {
      if (!file.type.startsWith('image/')) return resolve(null)
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        const idx = result.indexOf(',')
        resolve({
          data: idx >= 0 ? result.slice(idx + 1) : result,
          mediaType: file.type,
          name: file.name,
        })
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    const results = await Promise.all(arr.map(fileToAttachment))
    const next = results.filter((x): x is ImageAttachment => !!x)
    if (next.length) setAttachments((cur) => [...cur, ...next])
  }

  const removeAttachment = (i: number) =>
    setAttachments((cur) => cur.filter((_, idx) => idx !== i))

  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile()
        if (f && f.type.startsWith('image/')) files.push(f)
      }
    }
    if (files.length) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  // Удаляем системные IDE-теги, если они затесались в инпут (paste из chat-overlay и т.п.)
  const stripSystemTags = (s: string) =>
    s
      .replace(/<ide_[\w-]+>[\s\S]*?<\/ide_[\w-]+>/g, '')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/<\/?ide_[\w-]+>/g, '')
      .replace(/<\/?system-reminder>/g, '')
      .trim()

  const send = () => {
    const rawText = stripSystemTags(input).trim()
    const text = rawText
    if (!text && attachments.length === 0) return
    if (text.startsWith('/')) {
      const handled = handleSlash(text)
      setInput('')
      setSlashOpen(false)
      if (textRef.current) textRef.current.style.height = '58px'
      if (handled) return
    }
    if (busy) return
    const userMsg: Msg = {
      role: 'user',
      text:
        text +
        (attachments.length
          ? `\n\n_(${attachments.length} изобр.${attachments.length > 1 ? 'ия' : 'ение'})_`
          : ''),
    }
    setMessages((m) => [...m, userMsg])
    const sendText = text || 'Опиши прикреплённое изображение.'
    post({
      type: 'prompt',
      payload: { text: sendText, attachments },
    })
    if (settings.speculativeHaiku && attachments.length === 0) {
      post({ type: 'speculativeAsk', payload: { text: sendText } })
    }
    setInput('')
    setAttachments([])
    setMentionOpen(false)
    setSlashOpen(false)
    if (textRef.current) textRef.current.style.height = '58px'
  }

  const regenLast = () => {
    if (busy) return
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx < 0) return
    const last = messages[lastUserIdx] as Extract<Msg, { role: 'user' }>
    setMessages((m) => m.slice(0, lastUserIdx + 1))
    post({ type: 'prompt', payload: { text: last.text } })
  }

  const editUser = (idx: number) => {
    if (busy) return
    const m = messages[idx]
    if (m.role !== 'user') return
    setInput(m.text)
    setMessages((cur) => cur.slice(0, idx))
    setTimeout(() => {
      textRef.current?.focus()
      grow()
    }, 0)
  }

  const applyMention = (filePath: string) => {
    setInput((cur) => cur.replace(/(^|\s)@([\w./-]*)$/, (_, pre) => `${pre}@${filePath} `))
    setMentionOpen(false)
    textRef.current?.focus()
  }

  const applySlashSuggestion = (cmd: string) => {
    const justCmd = cmd.split(' ')[0]
    setInput(justCmd + ' ')
    setSlashOpen(false)
    textRef.current?.focus()
  }

  const onInput = (value: string) => {
    setInput(value)
    grow()
    const trimmed = value.trimStart()
    setSlashOpen(trimmed.startsWith('/') && !value.includes('\n'))
    const mentionMatch = value.match(/(^|\s)@([\w./-]*)$/)
    if (mentionMatch) {
      post({ type: 'listFiles', payload: { query: mentionMatch[2] } })
    } else {
      setMentionOpen(false)
      setMentionItems([])
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <LocaleContext.Provider value={locale}>
    <div
      className="relative flex h-full flex-col overflow-hidden bg-background text-foreground"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files)
      }}
    >
      <PixelGrid />
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center border-4 border-dashed border-pixel-magenta bg-pixel-magenta/15">
          <div className="flex items-center gap-2 border-2 border-foreground bg-card px-4 py-2 font-mono text-sm text-foreground shadow-[3px_3px_0_0_var(--foreground)]">
            <Px name="image-plus" className="size-4" />
            бросай — прикреплю
          </div>
        </div>
      )}
      {notice && (
        <div className="absolute right-4 top-14 z-30 flex items-center gap-2 border-2 border-foreground bg-card px-3 py-1.5 text-xs shadow-[3px_3px_0_0_var(--foreground)]">
          <Px name="alert" className="size-3.5 text-pixel-gold" />
          {notice}
        </div>
      )}
{/* Companion перенесён в Avatar активного сообщения (см. Row.assistant) */}

      <header className="flex shrink-0 items-center justify-between border-b-2 border-border bg-background/60 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center border-2 border-foreground bg-card shadow-[2px_2px_0_0_var(--foreground)]">
            <Mascot state="idle" className="block aspect-[24/16] w-5" />
          </span>
          <span className="bg-gradient-to-r from-brand-from via-brand-via to-brand-to bg-clip-text text-lg font-extrabold tracking-tight text-transparent">
            Cockpit
          </span>
          <span className="border-2 border-foreground bg-pixel-gold px-1.5 font-mono text-[13px] leading-5 text-black">
            v{version}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden max-w-[180px] truncate font-mono sm:inline">
            {workspace ?? 'no workspace'}
          </span>
          {!hasToken && (
            <Button
              size="sm"
              variant="brand"
              onClick={() => post({ type: 'setToken' })}
              title="Подключить Claude"
            >
              <Px name="lock" className="size-3.5" />
              Подключить
            </Button>
          )}
          <span
            className="border-2 border-pixel-gold/70 px-1.5 py-0.5 font-mono text-pixel-gold"
            title={`Сегодня · сессия $${sessionCost.toFixed(4)}`}
          >
            ${costToday.toFixed(2)}
          </span>
          {(sessionInputTokens > 0 || sessionOutputTokens > 0) && (
            <span
              className="border-2 border-pixel-cyan/60 px-1.5 py-0.5 font-mono text-pixel-cyan"
              title={`Сессия: ${sessionInputTokens} вход / ${sessionOutputTokens} выход${sessionCacheRead ? ` · кэш ${sessionCacheRead}` : ''}`}
            >
              ↓{compactNum(sessionInputTokens)} ↑{compactNum(sessionOutputTokens)}
            </span>
          )}
          {limits.five_hour && (
            <span
              className={`border-2 px-1.5 py-0.5 font-mono ${
                (limits.five_hour.utilization ?? 0) > 0.9
                  ? 'border-pixel-coral/70 text-pixel-coral'
                  : (limits.five_hour.utilization ?? 0) > 0.7
                    ? 'border-pixel-gold/70 text-pixel-gold'
                    : 'border-pixel-lime/60 text-pixel-lime'
              }`}
              title={`Текущая 5-часовая сессия подписки · ${timeUntil(limits.five_hour.resetsAt)}`}
            >
              {Math.round((limits.five_hour.utilization ?? 0) * 100)}%
            </span>
          )}
          {settings.pomodoroMinutes > 0 && (
            <button
              onClick={() => {
                if (pomoStart) {
                  setPomoStart(null)
                  setPomoLeft(null)
                } else {
                  setPomoStart(Date.now())
                }
              }}
              className={`flex items-center gap-1 border-2 px-1.5 py-0.5 font-mono text-[11px] ${
                pomoStart
                  ? 'border-pixel-coral text-pixel-coral'
                  : 'border-border hover:border-pixel-magenta'
              }`}
              title={pomoStart ? 'Остановить pomodoro' : 'Запустить pomodoro'}
            >
              <Px name="clock" className="size-3" />
              {pomoLeft != null
                ? `${String(Math.floor(pomoLeft / 60000)).padStart(2, '0')}:${String(Math.floor((pomoLeft % 60000) / 1000)).padStart(2, '0')}`
                : `${settings.pomodoroMinutes}м`}
            </button>
          )}
          <Button
            size="icon-sm"
            variant="outline"
            onClick={newChat}
            disabled={busy}
            title="Новый чат"
          >
            <Px name="plus" className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => setHelpOpen(true)}
            title="Документация"
          >
            <Px name="book-open" className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => post({ type: 'openSettings' })}
            title="Настройки (⌘⇧, — открыть в отдельной вкладке)"
          >
            <Px name="sliders" className="size-4" />
          </Button>
        </div>
      </header>

      {messages.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background/40 px-5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>модель · {MODELS.find((m) => m.id === model)?.label ?? model}</span>
          <span>·</span>
          <span>сообщений · {messages.filter((m) => m.role === 'user' || m.role === 'assistant').length}</span>
          {sessionCost > 0 && (
            <>
              <span>·</span>
              <span>сессия · ${sessionCost.toFixed(4)}</span>
            </>
          )}
          {settings.autoContext && (
            <>
              <span>·</span>
              <span className="text-pixel-cyan">auto-context</span>
            </>
          )}
        </div>
      )}

      <main ref={feedRef} className="relative flex-1 overflow-y-auto px-5 py-6">
        {messages.length === 0 ? (
          <Greeting
            hasToken={hasToken}
            liveJoke={liveJoke}
            onRefreshJoke={() => post({ type: 'requestJoke' })}
            onQuick={(t) => {
              setInput(t)
              setTimeout(() => {
                grow()
                textRef.current?.focus()
              }, 0)
            }}
          />
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const m = messages[vi.index]
              const isLastAssistant =
                m.role === 'assistant' &&
                !m.streaming &&
                !messages.slice(vi.index + 1).some((x) => x.role === 'assistant')
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vi.start}px)`,
                    paddingBottom: 16,
                  }}
                >
                  <Row
                    idx={vi.index}
                    msg={m}
                    onRespond={respond}
                    onRegen={isLastAssistant && !busy ? regenLast : undefined}
                    onEdit={!busy ? editUser : undefined}
                    onFork={
                      m.role === 'assistant' && !busy
                        ? () => post({ type: 'forkFromMessage', payload: { idx: vi.index } })
                        : undefined
                    }
                  />
                </div>
              )
            })}
          </div>
        )}
        {busy && !streaming && !awaitingPermission && (
          <div className="mt-3">
            <Thinking />
          </div>
        )}
      </main>

      <div className="relative">
        {mentionOpen && mentionItems.length > 0 && (
          <div className="absolute bottom-full left-5 right-5 z-30 mb-2 max-h-48 overflow-y-auto border-2 border-border bg-card shadow-[3px_3px_0_0_var(--foreground)]">
            {mentionItems.slice(0, 12).map((f) => (
              <button
                key={f.path}
                onClick={() => applyMention(f.path)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-pixel-magenta/15"
              >
                <Px name="folder" className="size-3.5 text-pixel-cyan" />
                <span className="font-medium">{f.name}</span>
                <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                  {f.path}
                </span>
              </button>
            ))}
          </div>
        )}
        {slashOpen && (
          <div className="absolute bottom-full left-5 right-5 z-30 mb-2 border-2 border-border bg-card shadow-[3px_3px_0_0_var(--foreground)]">
            {SLASH_COMMANDS.map((c) => (
              <button
                key={c.cmd}
                onClick={() => applySlashSuggestion(c.cmd)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-pixel-magenta/15"
              >
                <span className="font-mono font-semibold text-pixel-magenta">{c.cmd}</span>
                <span className="ml-2 text-muted-foreground">{c.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <footer className="flex shrink-0 flex-col gap-2 border-t-2 border-border bg-background/60 px-5 py-3.5 backdrop-blur">
        <div className="relative flex items-center gap-2 text-[11px] text-muted-foreground">
          <Picker value={model} onChange={changeModel} options={MODELS} />
          {settings.autoContext && (
            <span
              className="flex items-center gap-1 border border-pixel-cyan/60 px-1.5 py-0.5 font-mono text-pixel-cyan"
              title="Auto-context: открытые табы + выделение + git diff (вкл. в Settings)"
            >
              <Px name="folder" className="size-3" /> авто-контекст
            </span>
          )}
          {settings.speculativeHaiku && (
            <span
              className="flex items-center gap-1 border border-pixel-lime/60 px-1.5 py-0.5 font-mono text-pixel-lime"
              title="Speculative Haiku — параллельный быстрый ответ"
            >
              ⚡ haiku
            </span>
          )}
          <button
            onClick={() => post({ type: 'attachProjectTree' })}
            className="flex items-center gap-1 border border-border bg-card px-1.5 py-0.5 hover:border-pixel-magenta"
            title="Прикрепить дерево проекта"
          >
            <Px name="tree" className="size-3" /> tree
          </button>
          <button
            onClick={() => {
              if (!libraryOpen) post({ type: 'listPrompts' })
              setLibraryOpen((v) => !v)
            }}
            className="flex items-center gap-1 border border-border bg-card px-1.5 py-0.5 hover:border-pixel-magenta"
            title="Шаблоны промптов"
          >
            <Px name="file-multiple" className="size-3" /> шаблоны ({prompts.length})
          </button>
          <button
            onClick={startVoice}
            className="flex items-center gap-1 border border-border bg-card px-1.5 py-0.5 hover:border-pixel-magenta"
            title="Голосовой ввод — откроется поле VS Code, активируй системную диктовку (macOS: двойной Fn, Windows: Win+H)"
          >
            <Px name="speaker" className="size-3" /> голос
          </button>
          <span className="ml-auto font-mono">
            ~{Math.ceil(input.length / 4)} ток.
          </span>
          {libraryOpen && (
            <div className="absolute bottom-full left-0 z-30 mb-1 max-h-60 w-80 overflow-y-auto border-2 border-border bg-card shadow-[3px_3px_0_0_var(--foreground)]">
              {prompts.length === 0 && (
                <div className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                  Сохрани шаблон в Settings → Шаблоны промптов
                </div>
              )}
              {prompts.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    setInput((cur) => (cur ? cur + '\n\n' + p.content : p.content))
                    setLibraryOpen(false)
                    setTimeout(() => {
                      grow()
                      textRef.current?.focus()
                    }, 0)
                  }}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-1.5 text-left hover:bg-pixel-magenta/15"
                >
                  <span className="font-mono text-xs text-pixel-cyan">{p.name}</span>
                  <span className="line-clamp-1 text-[11px] text-muted-foreground">
                    {p.content.slice(0, 80)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div
                key={i}
                className="group relative border-2 border-border bg-card shadow-[2px_2px_0_0_var(--foreground)]"
              >
                <img
                  src={`data:${a.mediaType};base64,${a.data}`}
                  alt={a.name}
                  className="h-14 w-14 object-cover"
                />
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -right-1 -top-1 grid size-4 place-items-center border border-foreground bg-pixel-coral text-[10px] leading-none text-black opacity-0 transition-opacity group-hover:opacity-100"
                  title="Удалить"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-stretch gap-2.5">
        <textarea
          ref={textRef}
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={
            hasToken
              ? tx('chat.input.placeholder', locale)
              : tx('chat.greeting.noToken', locale)
          }
          rows={2}
          disabled={busy && !awaitingPermission}
          className="min-h-[58px] flex-1 resize-none rounded-[4px] border-2 border-input bg-background/80 px-3.5 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus:border-pixel-magenta focus:ring-2 focus:ring-pixel-magenta/30 disabled:opacity-50"
        />
        {busy ? (
          <Button
            variant="outline"
            className="h-auto w-14 self-stretch"
            onClick={stop}
            title={tx('chat.input.stop', locale)}
          >
            <Px name="close" className="size-5" />
          </Button>
        ) : (
          <Button
            variant="brand"
            className="h-auto w-14 self-stretch"
            onClick={send}
            disabled={!input.trim() && attachments.length === 0}
            title={tx('chat.input.send', locale)}
          >
            <Px name="send" className="size-5" />
          </Button>
        )}
        </div>
      </footer>
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </div>
    </LocaleContext.Provider>
  )
}

function Greeting({
  hasToken,
  liveJoke,
  onQuick,
  onRefreshJoke,
}: {
  hasToken: boolean
  liveJoke: string | null
  onQuick: (text: string) => void
  onRefreshJoke: () => void
}) {
  const t = useT()
  const [i, setI] = useState(() => Math.floor(Math.random() * JOKES.length))
  useEffect(() => {
    const t = setInterval(() => setI((p) => (p + 1) % JOKES.length), 8000)
    return () => clearInterval(t)
  }, [])

  const actions: { emoji: string; title: string; hint: string; text: string }[] = [
    { emoji: '🔍', title: t('chat.quick.findBySense.title'), hint: t('chat.quick.findBySense.hint'), text: '/find где регистрируется аутентификация' },
    { emoji: '🧪', title: t('chat.quick.tests.title'), hint: t('chat.quick.tests.hint'), text: '/tests' },
    { emoji: '🔁', title: t('chat.quick.loop.title'), hint: t('chat.quick.loop.hint'), text: '/loop pnpm test' },
    { emoji: '📚', title: t('chat.quick.docs.title'), hint: t('chat.quick.docs.hint'), text: '/help' },
  ]

  const joke = liveJoke ?? JOKES[i]

  return (
    <div className="m-auto w-full max-w-2xl px-6 text-center">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
        // unyly
      </div>
      <pre className="mx-auto mb-1 inline-block bg-gradient-to-r from-pixel-cyan via-pixel-magenta to-pixel-pink bg-clip-text font-mono text-[10px] leading-[1.1] font-bold text-transparent sm:text-[12px]">
{`░█▀▀░█▀█░█▀▀░█░█░█▀█░▀█▀░▀█▀
░█░░░█░█░█░░░█▀▄░█▀▀░░█░░░█░
░▀▀▀░▀▀▀░▀▀▀░▀░▀░▀░░░▀▀▀░░▀░`}
      </pre>
      <div className="mb-5 flex items-center justify-center gap-2">
        <Mascot state="idle" className="block aspect-[24/16] w-9" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-pixel-magenta">
          ready · share-aware · agent online
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {actions.map((a) => (
          <button
            key={a.title}
            onClick={() => onQuick(a.text)}
            className="group flex flex-col items-start gap-1 border-2 border-border bg-card/60 p-3 text-left transition-all hover:border-pixel-magenta hover:bg-card hover:shadow-[3px_3px_0_0_var(--foreground)]"
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="text-base leading-none">{a.emoji}</span>
              {a.title}
            </div>
            <div className="text-[11px] text-muted-foreground">{a.hint}</div>
            <code className="mt-1 truncate font-mono text-[10px] text-pixel-cyan group-hover:text-pixel-magenta">
              {a.text}
            </code>
          </button>
        ))}
      </div>
      <p className="mx-auto mt-4 max-w-md text-xs leading-relaxed text-muted-foreground/70">
        @<code className="font-mono text-pixel-cyan">путь</code> — упомянуть файл ·{' '}
        <code className="font-mono text-pixel-cyan">/</code> — команды ·{' '}
        <code className="font-mono text-pixel-cyan">⌘⇧K</code> открыть ·{' '}
        <code className="font-mono text-pixel-cyan">⌘⇧J</code> быстрый вопрос
      </p>
      <div className="mx-auto mt-4 flex items-center justify-center gap-1.5">
        <p
          key={liveJoke ?? `j${i}`}
          className="font-mono text-[11px] text-muted-foreground/60 [animation:fade-up_0.4s_steps(8,end)_both]"
        >
          {joke}
        </p>
        <button
          onClick={onRefreshJoke}
          title="Новая шутка (через Haiku)"
          className="border border-border bg-background px-1 text-[10px] text-muted-foreground hover:border-pixel-magenta hover:text-pixel-magenta"
        >
          ↺
        </button>
      </div>
      {!hasToken && (
        <p className="mt-3 text-xs text-pixel-coral">⚠ Сначала подключи токен в Settings.</p>
      )}
    </div>
  )
}

function Thinking() {
  return (
    <div className="flex gap-3">
      <Avatar state="thinking" />
      <div className="flex items-center gap-2 pt-1 font-mono text-sm text-pixel-cyan">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-2 bg-pixel-cyan"
              style={{ animation: `pixel-pulse 1.1s steps(2,end) ${i * 0.15}s infinite` }}
            />
          ))}
        </span>
        думает…
      </div>
    </div>
  )
}

function Picker({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { id: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="cursor-pointer rounded-[2px] border-2 border-border bg-card px-1.5 py-1 font-mono text-xs text-foreground outline-none focus:border-pixel-magenta"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

type AvatarState = 'idle' | 'thinking' | 'stream' | 'wait'

function Avatar({ state = 'idle' }: { state?: AvatarState }) {
  const wrapperAnim =
    state === 'thinking'
      ? 'animate-[pixel-pulse_1.2s_steps(4,end)_infinite]'
      : state === 'stream'
        ? 'animate-[pixel-pulse_0.8s_steps(4,end)_infinite]'
        : state === 'wait'
          ? 'animate-[blink_1s_steps(2,end)_infinite]'
          : ''
  return (
    <span
      className={`mt-0.5 grid size-7 shrink-0 place-items-center border-2 border-foreground bg-card shadow-[2px_2px_0_0_var(--foreground)] ${wrapperAnim}`}
    >
      <Mascot state={state} className="block size-5" />
    </span>
  )
}

function Row({
  msg,
  idx,
  onRespond,
  onRegen,
  onEdit,
  onFork,
}: {
  msg: Msg
  idx: number
  onRespond: (id: string, ok: boolean) => void
  onRegen?: () => void
  onEdit?: (i: number) => void
  onFork?: () => void
}) {
  switch (msg.role) {
    case 'user':
      return (
        <div className="group flex justify-end [animation:fade-up_0.25s_steps(6,end)_both]">
          <div className="relative max-w-[78%]">
            <div className="rounded-[4px] border border-border bg-gradient-to-br from-pixel-indigo/25 to-pixel-magenta/20 px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap">
              {msg.text}
            </div>
            {onEdit && (
              <button
                onClick={() => onEdit(idx)}
                className="absolute -top-2 right-2 border border-border bg-card px-1 font-mono text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-pixel-cyan"
                title="Редактировать и переотправить"
              >
                edit
              </button>
            )}
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div className="group flex gap-3 [animation:fade-up_0.25s_steps(6,end)_both]">
          <Avatar state={msg.streaming ? 'stream' : 'idle'} />
          <div className="min-w-0 flex-1 pt-0.5">
            <Markdown>{msg.text}</Markdown>
            {msg.streaming && (
              <span className="ml-0.5 inline-block h-[1.05em] w-2 translate-y-[2px] bg-pixel-lime [animation:blink_1s_steps(2,end)_infinite]" />
            )}
            <div className="mt-1 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              {onRegen && (
                <button
                  onClick={onRegen}
                  className="inline-flex items-center gap-1 border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-pixel-magenta"
                  title="Перегенерировать ответ"
                >
                  <Px name="reload" className="size-3" />
                  regen
                </button>
              )}
              {onFork && (
                <button
                  onClick={onFork}
                  className="inline-flex items-center gap-1 border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-pixel-cyan"
                  title="Форк сессии от этой точки"
                >
                  <Px name="git-branch" className="size-3" />
                  fork
                </button>
              )}
            </div>
          </div>
        </div>
      )
    case 'tool':
      return (
        <div className="flex gap-3">
          <span className="size-7 shrink-0" />
          <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <Px name="search" className="size-3.5 text-pixel-lime" />
            <span className="text-foreground/80">{msg.name}</span>
            <span>· читает воркспейс…</span>
          </div>
        </div>
      )
    case 'permission':
      return <PermissionCard msg={msg} onRespond={onRespond} />
    case 'result':
      return (
        <div className="flex gap-3">
          <span className="size-7 shrink-0" />
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/60">
            <Px name="sparkle" className="size-3" />
            {msg.turns} итер. · ${msg.costUsd.toFixed(4)}
          </div>
        </div>
      )
    case 'error':
      return (
        <div className="flex gap-3 [animation:fade-up_0.25s_steps(6,end)_both]">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[4px] border border-pixel-coral bg-destructive/20 text-pixel-coral">
            <Px name="alert" className="size-4" />
          </span>
          <div className="min-w-0 flex-1 rounded-[4px] border border-pixel-coral/50 bg-destructive/15 px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap text-pixel-pink">
            {msg.text}
          </div>
        </div>
      )
    case 'speculative':
      return (
        <div className="flex gap-3 opacity-60 [animation:fade-up_0.25s_steps(6,end)_both]">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[4px] border border-dashed border-pixel-cyan text-pixel-cyan">
            <Px name="speaker" className="size-4" />
          </span>
          <div className="min-w-0 flex-1 border border-dashed border-pixel-cyan/40 bg-pixel-cyan/5 px-3.5 py-2 text-sm leading-relaxed">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-pixel-cyan">
              ⚡ haiku превью
            </div>
            <div className="whitespace-pre-wrap">{msg.text}</div>
          </div>
        </div>
      )
  }
}

function PermissionCard({
  msg,
  onRespond,
}: {
  msg: Extract<Msg, { role: 'permission' }>
  onRespond: (id: string, ok: boolean) => void
}) {
  const { detail, status } = msg
  const title =
    detail.kind === 'edit'
      ? 'Изменить файл'
      : detail.kind === 'write'
        ? 'Записать файл'
        : detail.kind === 'bash'
          ? 'Выполнить команду'
          : `Инструмент: ${detail.tool}`
  const target =
    detail.kind === 'edit' || detail.kind === 'write'
      ? detail.file
      : detail.kind === 'bash'
        ? detail.description || ''
        : ''

  return (
    <div className="flex gap-3 [animation:fade-up_0.25s_steps(6,end)_both]">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[4px] border-2 border-foreground bg-pixel-gold text-black">
        <Px name="lock" className="size-4" />
      </span>
      <div className="min-w-0 flex-1 rounded-[4px] border-2 border-border bg-card shadow-[3px_3px_0_0_var(--foreground)]">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold">{title}</span>
          {target && (
            <span className="ml-3 truncate font-mono text-xs text-pixel-cyan">{target}</span>
          )}
        </div>

        <div className="max-h-72 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed">
          {detail.kind === 'edit' && <Diff oldText={detail.oldText} newText={detail.newText} />}
          {detail.kind === 'write' && (
            <pre className="whitespace-pre-wrap text-foreground/90">{detail.content}</pre>
          )}
          {detail.kind === 'bash' && (
            <pre className="whitespace-pre-wrap text-pixel-lime">$ {detail.command}</pre>
          )}
          {detail.kind === 'other' && (
            <pre className="whitespace-pre-wrap text-muted-foreground">
              {JSON.stringify(detail.input, null, 2)}
            </pre>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          {status === 'pending' ? (
            <>
              <Button size="sm" variant="brand" onClick={() => onRespond(msg.id, true)}>
                <Px name="check" className="size-3.5" />
                Принять
              </Button>
              <Button size="sm" variant="outline" onClick={() => onRespond(msg.id, false)}>
                <Px name="close" className="size-3.5" />
                Отклонить
              </Button>
            </>
          ) : (
            <span
              className={`font-mono text-xs ${status === 'approved' ? 'text-pixel-lime' : 'text-muted-foreground'}`}
            >
              {status === 'approved' ? '✓ принято' : '✕ отклонено'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function Diff({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <div className="space-y-2">
      {oldText && (
        <div>
          {oldText.split('\n').map((l, i) => (
            <div key={i} className="bg-destructive/15 px-1 text-pixel-pink">
              <span className="select-none opacity-50">- </span>
              {l || ' '}
            </div>
          ))}
        </div>
      )}
      <div>
        {newText.split('\n').map((l, i) => (
          <div key={i} className="bg-pixel-lime/10 px-1 text-pixel-lime">
            <span className="select-none opacity-50">+ </span>
            {l || ' '}
          </div>
        ))}
      </div>
    </div>
  )
}

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-[min(720px,94vw)] flex-col overflow-hidden border-2 border-foreground bg-card shadow-[5px_5px_0_0_var(--foreground)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b-2 border-border px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
            <Px name="book-open" className="size-4" /> Cockpit · документация
          </h2>
          <button
            onClick={onClose}
            className="grid size-7 place-items-center border-2 border-border hover:border-pixel-coral hover:text-pixel-coral"
          >
            <Px name="close" className="size-4" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm leading-relaxed">
          <HelpSection title="Горячие клавиши">
            <KV k="Cmd+Shift+K" v="открыть Cockpit" />
            <KV k="Cmd+Shift+J" v="быстрый вопрос из палитры (без открытия панели)" />
            <KV k="Cmd+Shift+E" v="объяснить выделение inline (side-by-side)" />
            <KV k="Enter" v="отправить" />
            <KV k="Shift+Enter" v="перенос строки" />
          </HelpSection>

          <HelpSection title="Slash-команды (печатай с `/`)">
            <KV k="/clear" v="очистить чат, новая сессия" />
            <KV k="/export" v="сохранить сессию в .md через диалог" />
            <KV k="/share" v="опубликовать сессию как GitHub Gist (нужен gh CLI)" />
            <KV k="/loop <cmd>" v="агент гоняет команду до зелёного (макс 5 итераций)" />
            <KV k="/tests" v="quick-pick тестовых команд и автопочинка падения" />
            <KV k="/find <смысл>" v="семантический поиск по коду (через Grep/Glob)" />
            <KV k="/replace" v="AI Find & Replace по воркспейсу" />
            <KV k="/cost" v="статистика стоимости" />
            <KV k="/model <opus|sonnet|haiku|default>" v="сменить модель" />
            <KV k="/help" v="подсказка по командам" />
          </HelpSection>

          <HelpSection title="Композер">
            <KV k="@<путь>" v="автокомплит файлов воркспейса, агент сам прочитает" />
            <KV k="/" v="попап с slash-командами" />
            <KV k="🌲 tree" v="прикрепить дерево проекта как контекст" />
            <KV k="📄 шаблоны" v="вставить шаблон из .cockpit/prompts/*.md" />
            <KV k="🔊 голос" v="голосовой ввод (Web Speech API, ru-RU)" />
            <KV k="Drag & drop / Paste" v="прикрепить изображения (мультимодал)" />
          </HelpSection>

          <HelpSection title="Действия над сообщениями">
            <KV k="edit (на своём)" v="вернуть текст в инпут, удалить всё после, переотправить" />
            <KV k="regen (на последнем ответе)" v="перегенерировать ответ" />
            <KV k="fork (на ответе)" v="форкнуть сессию от этой точки" />
            <KV k="copy (над code-блоком)" v="скопировать код в буфер" />
          </HelpSection>

          <HelpSection title="Правки кода">
            <p className="text-muted-foreground">
              Чтение (Read/Glob/Grep) — авто. Запись (Edit/Write/Bash) — карточка в чате
              <b className="text-foreground"> + рядом в редакторе открывается diff editor</b>.
              Кнопки <code>Принять</code>/<code>Отклонить</code>. В Settings: политика разрешений
              (Спрашивать всё / Edits авто / YOLO), path-allowlist, запрет Bash-паттернов,
              snapshot через <code>git stash</code> перед каждой правкой, audit-журнал.
            </p>
          </HelpSection>

          <HelpSection title="Интеграция с редактором">
            <KV k="CodeLens над функциями" v="ссылка «🚀 Ask Cockpit» над каждой функцией/классом/методом" />
            <KV k="Контекстное меню (правый клик)" v="«Спросить про выделение» / «Объяснить выделение inline»" />
            <KV k="Code Action на ошибке" v="лампочка → «🚀 Fix with Cockpit» — диагностика + контекст идут как промпт" />
            <KV k="Inline-completions (Tab)" v="вкл. в Settings; модель Haiku через подписку; LRU-кеш; авто-триггер опц." />
            <KV k="Cockpit: Run Tests & Fix" v="команда в палитре или /tests — quick-pick команды тестов + автопочинка" />
            <KV k="Cockpit: AI Find & Replace" v="команда в палитре или /replace — поиск/замена по смыслу" />
            <KV k="Cockpit: Share Session (Gist)" v="публикация через gh gist; URL в буфер" />
          </HelpSection>

          <HelpSection title="История сессий">
            <p className="text-muted-foreground">
              Иконка <b>Cockpit</b> в Activity Bar VS Code → панель «История». Все сессии этого
              воркспейса (из SDK), поиск, переименование (pen), форк (fork), удаление (del).
              Клик — переключение на сессию с восстановлением сообщений.
            </p>
          </HelpSection>

          <HelpSection title="Темы">
            <p className="text-muted-foreground">
              6 встроенных (Аркада/Светлая/Синтвейв/Матрица/Янтарь/Полночь) + <b>Своя</b> через color
              picker в Settings. Темы синхронизированы с темами всего редактора (Color Theme в палитре):
              там есть «Cockpit Arcade», «Cockpit Synthwave» и т.д. — выбираешь обе одновременно.
            </p>
          </HelpSection>

          <HelpSection title="Настройки (⚙)">
            <KV k="Автоконтекст" v="к каждому промпту: открытые табы + выделение + git diff --stat" />
            <KV k="Path-allowlist" v="globs где разрешены Edit/Write (пусто = везде)" />
            <KV k="Бюджеты" v="лимит $/день и $/сессия с автостопом" />
            <KV k="Snapshot перед правкой" v="git stash push -k -u перед каждым approved Edit/Write" />
            <KV k="Audit log" v=".cockpit/audit.log JSONL всех действий агента" />
            <KV k="WebSearch / WebFetch" v="вкл/выкл web-инструментов агента" />
            <KV k="Pomodoro" v="таймер фокус-сессии в шапке (0 = выкл)" />
            <KV k="Speculative Haiku" v="параллельный быстрый превью-ответ пока Opus думает" />
            <KV k="Companion" v="маскот-индикатор состояния агента в правом углу" />
            <KV k="MCP servers" v="визуальный редактор stdio/http серверов с env-переменными" />
            <KV k="CLAUDE.md" v="кнопка открыть/создать память воркспейса; авто-reload при изменении" />
            <KV k="Шаблоны промптов" v="хранятся в .cockpit/prompts/*.md, доступны из композера" />
          </HelpSection>

          <HelpSection title="Achievements">
            <p className="text-muted-foreground">
              🚀 первый запрос · 🔥 10 запросов/день · 🌋 50/день · ✏️ первая принятая правка ·
              🛠️ 50 правок/день · 🌿 первый форк · 🦉 ночная сова (22:00–06:00).
            </p>
          </HelpSection>

          <HelpSection title="Обновление расширения">
            <p className="text-muted-foreground">
              <code>pnpm redeploy</code> из папки <code>cockpit/</code> — бамп версии, build,
              vsce package, install, потом <kbd>Cmd+Shift+P → Developer: Reload Window</kbd>.
            </p>
          </HelpSection>
        </div>
      </div>
    </div>
  )
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-pixel-magenta">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-3 text-xs">
      <code className="shrink-0 border border-border bg-background px-1.5 py-0.5 font-mono text-pixel-cyan">
        {k}
      </code>
      <span className="flex-1 text-muted-foreground">{v}</span>
    </div>
  )
}


function PixelGrid() {
  const cells = useMemo(() => {
    const colors = [
      'var(--pixel-magenta)',
      'var(--pixel-indigo)',
      'var(--pixel-cyan)',
      'var(--pixel-lime)',
    ]
    return Array.from({ length: 22 }, () => ({
      left: Math.random() * 100,
      top: Math.random() * 100,
      delay: Math.random() * 6,
      dur: 4 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
    }))
  }, [])

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-50 [animation:aurora-drift_28s_ease-in-out_infinite_alternate]"
        style={{
          background:
            'radial-gradient(40vw 40vw at 80% 8%, var(--pixel-magenta), transparent 72%), radial-gradient(46vw 46vw at 12% 95%, var(--pixel-indigo), transparent 74%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-60 [animation:grid-pan_16s_linear_infinite]"
        style={{
          backgroundImage:
            'linear-gradient(oklch(0.6 0.16 290 / 0.13) 1px, transparent 1px), linear-gradient(90deg, oklch(0.6 0.16 290 / 0.13) 1px, transparent 1px)',
          backgroundSize: '38px 38px',
          maskImage: 'radial-gradient(ellipse at 50% 35%, #000 25%, transparent 82%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 35%, #000 25%, transparent 82%)',
        }}
      />
      {cells.map((c, i) => (
        <span
          key={i}
          className="absolute size-[6px]"
          style={{
            left: `${c.left}%`,
            top: `${c.top}%`,
            background: c.color,
            animation: `cell-twinkle ${c.dur}s ease-in-out ${c.delay}s infinite`,
          }}
        />
      ))}
    </div>
  )
}
