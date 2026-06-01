import { useEffect, useState } from 'react'
import type { SessionEntry } from '../../src/protocol'
import { onMessage, post } from './vscode'
import { Px } from './components/px'
import { LocaleContext, type Locale } from './i18n'

function fmtTime(ts: number, locale: Locale) {
  const d = new Date(ts)
  const today = new Date()
  const lang = locale === 'ru' ? 'ru' : 'en'
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString())
    return locale === 'ru' ? 'вчера' : 'yesterday'
  return d.toLocaleDateString(lang, { day: '2-digit', month: '2-digit' })
}

export function Sidebar() {
  const [locale, setLocale] = useState<Locale>('en')
  const [theme, setTheme] = useState('arcade')
  const [items, setItems] = useState<SessionEntry[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [costToday, setCostToday] = useState(0)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const off = onMessage((msg) => {
      switch (msg.type) {
        case 'ready':
          setTheme(msg.payload.theme)
          setCostToday(msg.payload.costToday)
          if (msg.payload.locale) setLocale(msg.payload.locale)
          break
        case 'cost':
          setCostToday(msg.payload.today)
          break
        case 'themeChanged':
          setTheme(msg.payload.theme)
          break
        case 'sessions':
          setItems(msg.payload.items)
          setCurrentId(msg.payload.currentId)
          break
      }
    })
    post({ type: 'hello', payload: { view: 'sidebar' } })
    post({ type: 'listSessions' })
    return off
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const open = (id: string) => post({ type: 'loadSession', payload: { sessionId: id } })
  const rename = (id: string, current: string) => {
    const title = prompt('Новое название сессии:', current)
    if (title && title.trim()) post({ type: 'renameSession', payload: { sessionId: id, title: title.trim() } })
  }
  const remove = (id: string) => {
    if (confirm('Удалить сессию?')) post({ type: 'deleteSession', payload: { sessionId: id } })
  }
  const fork = (id: string) => post({ type: 'forkSession', payload: { sessionId: id } })
  const newChat = () => post({ type: 'newSession' })

  const filtered = items.filter(
    (s) =>
      !filter ||
      s.title.toLowerCase().includes(filter.toLowerCase()) ||
      (s.firstPrompt ?? '').toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <LocaleContext.Provider value={locale}>
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-2 border-b-2 border-border bg-background px-2 py-2">
        <button
          onClick={newChat}
          className="flex items-center gap-1 border-2 border-foreground bg-pixel-magenta px-2 py-1 text-xs font-semibold text-white shadow-[2px_2px_0_0_var(--foreground)] hover:bg-pixel-pink active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          <Px name="plus" className="size-3.5" />
          новый
        </button>
        <span className="ml-auto font-mono text-[11px] text-pixel-gold">
          ${costToday.toFixed(2)} сегодня
        </span>
      </div>

      <div className="shrink-0 border-b border-border px-2 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Поиск…"
          className="w-full border-2 border-input bg-card px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus:border-pixel-magenta"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 && items.length === 0 && (
          <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
            <div className="mx-auto mb-2 grid size-10 place-items-center border-2 border-border bg-card">
              <Px name="folder" className="size-5 text-pixel-magenta" />
            </div>
            <div className="mb-1 font-semibold text-foreground">Сессий пока нет</div>
            <p className="leading-relaxed">
              Нажми <b className="text-pixel-magenta">новый</b> и задай первый вопрос —
              сессия появится здесь автоматически.
            </p>
          </div>
        )}
        {filtered.length === 0 && items.length > 0 && (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            Ничего не найдено
          </div>
        )}
        <ul className="flex flex-col gap-1.5">
          {filtered.map((s) => {
            const active = s.sessionId === currentId
            return (
              <li
                key={s.sessionId}
                className={`group cursor-pointer border-2 px-2 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-pixel-magenta bg-pixel-magenta/15'
                    : 'border-border bg-card hover:border-pixel-magenta/60'
                }`}
                onClick={() => open(s.sessionId)}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="line-clamp-2 flex-1 font-medium">{s.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {fmtTime(s.lastModified, locale)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      rename(s.sessionId, s.title)
                    }}
                    className="border border-border bg-background px-1 text-[10px] hover:text-pixel-cyan"
                    title="Переименовать"
                  >
                    pen
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      fork(s.sessionId)
                    }}
                    className="border border-border bg-background px-1 text-[10px] hover:text-pixel-lime"
                    title="Форк"
                  >
                    fork
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      remove(s.sessionId)
                    }}
                    className="ml-auto border border-border bg-background px-1 text-[10px] hover:text-pixel-coral"
                    title="Удалить"
                  >
                    del
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
    </LocaleContext.Provider>
  )
}
