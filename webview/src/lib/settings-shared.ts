// Общие константы и хелперы Settings — переиспользуются и в основном чате, и в отдельной Settings-панели.

export const THEMES = [
  { id: 'arcade', label: 'Аркада' },
  { id: 'light', label: 'Светлая' },
  { id: 'synthwave', label: 'Синтвейв' },
  { id: 'matrix', label: 'Матрица' },
  { id: 'amber', label: 'Янтарь' },
  { id: 'midnight', label: 'Полночь' },
  { id: 'custom', label: 'Своя' },
]

// Палитра-превью для миниатюр-плиток.
export const THEME_PREVIEW: Record<string, { bg: string; fg: string; dots: string[] }> = {
  arcade: { bg: 'oklch(0.13 0.025 275)', fg: 'oklch(0.93 0.01 80)', dots: ['oklch(0.7 0.2 350)', 'oklch(0.78 0.12 200)', 'oklch(0.82 0.14 130)', 'oklch(0.82 0.14 80)'] },
  light: { bg: 'oklch(0.985 0.005 80)', fg: 'oklch(0.22 0.02 270)', dots: ['oklch(0.5 0.2 350)', 'oklch(0.55 0.13 210)', 'oklch(0.62 0.16 145)', 'oklch(0.65 0.14 75)'] },
  synthwave: { bg: 'oklch(0.15 0.06 300)', fg: 'oklch(0.92 0.03 320)', dots: ['oklch(0.72 0.22 345)', 'oklch(0.82 0.15 200)', 'oklch(0.82 0.14 160)', 'oklch(0.82 0.14 80)'] },
  matrix: { bg: 'oklch(0.13 0.02 150)', fg: 'oklch(0.86 0.13 140)', dots: ['oklch(0.82 0.14 140)', 'oklch(0.78 0.12 190)', 'oklch(0.9 0.23 130)', 'oklch(0.82 0.13 105)'] },
  amber: { bg: 'oklch(0.14 0.025 60)', fg: 'oklch(0.84 0.12 75)', dots: ['oklch(0.76 0.14 45)', 'oklch(0.78 0.1 90)', 'oklch(0.82 0.13 95)', 'oklch(0.84 0.14 80)'] },
  midnight: { bg: 'oklch(0.17 0.025 250)', fg: 'oklch(0.9 0.02 240)', dots: ['oklch(0.7 0.14 320)', 'oklch(0.78 0.11 210)', 'oklch(0.8 0.12 160)', 'oklch(0.8 0.12 85)'] },
  custom: { bg: '#1a1a2e', fg: '#f5efe6', dots: ['#e87bb6', '#a7e7f0', '#c4e88a', '#e0c172'] },
}

export const MODELS = [
  { id: 'default', label: 'Авто' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
]

export const SYSTEM_PRESETS = [
  { name: 'Краткий', text: 'Отвечай кратко и по делу. Без воды.' },
  { name: 'Подробный', text: 'Объясняй подробно: контекст, шаги, причины. Когда уместно — примеры.' },
  { name: 'Senior', text: 'Ты senior-инженер. Без воды и хедж-формулировок. Прямо называй риски, предлагай реальные альтернативы. Допущения — явно.' },
  { name: 'Ревью', text: 'Ты опытный ревьюер. Ищи баги, утечки, edge-cases, проблемы безопасности и читаемости. Цитируй конкретные строки.' },
  { name: 'Учитель', text: 'Объясняй пошагово, расшифровывай термины, давай аналогии. Считай, что собеседник новичок в этой области.' },
]

export const CUSTOM_THEME_FIELDS: { key: string; label: string; default: string }[] = [
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

export const RATE_LIMIT_ORDER: { key: string; label: string }[] = [
  { key: 'five_hour', label: 'Текущая сессия (5 ч)' },
  { key: 'seven_day', label: 'Неделя · все модели' },
  { key: 'seven_day_sonnet', label: 'Неделя · Sonnet' },
  { key: 'seven_day_opus', label: 'Неделя · Opus' },
  { key: 'overage', label: 'Overage credits' },
]

export const ACHIEVEMENTS_META: { id: string; emoji: string; label: string; hint: string }[] = [
  { id: 'first_session', emoji: '🚀', label: 'Первый запрос', hint: 'Любой запрос в Cockpit' },
  { id: 'ten_prompts_day', emoji: '🔥', label: '10 запросов / день', hint: 'Запусти 10 за один день' },
  { id: 'fifty_prompts_day', emoji: '🌋', label: '50 запросов / день', hint: 'Запусти 50 за один день' },
  { id: 'first_edit_approved', emoji: '✏️', label: 'Первая правка', hint: 'Одобри первую Edit/Write' },
  { id: 'fifty_edits_day', emoji: '🛠️', label: '50 правок / день', hint: '50 одобренных правок за день' },
  { id: 'first_fork', emoji: '🌿', label: 'Первый форк', hint: 'Сделай форк сессии' },
  { id: 'night_owl', emoji: '🦉', label: 'Ночная сова', hint: 'Запрос между 22:00 и 06:00' },
]

export function compactNum(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return (n / 1000).toFixed(1).replace('.0', '') + 'k'
  if (n < 1_000_000) return Math.round(n / 1000) + 'k'
  return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M'
}

export function timeUntil(ts?: number): string {
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

export interface McpServer {
  name: string
  type: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

export function parseMcpServers(json: string): McpServer[] {
  if (!json.trim()) return []
  try {
    const raw = JSON.parse(json)
    if (!raw || typeof raw !== 'object') return []
    return Object.entries(raw).map(([name, v]: [string, any]) => ({
      name,
      type: v?.type === 'http' ? 'http' : 'stdio',
      command: v?.command,
      args: Array.isArray(v?.args) ? v.args : undefined,
      url: v?.url,
      env: v?.env && typeof v.env === 'object' ? v.env : undefined,
    }))
  } catch {
    return []
  }
}

export function serializeMcpServers(list: McpServer[]): string {
  if (list.length === 0) return ''
  const obj: Record<string, any> = {}
  for (const s of list) {
    if (!s.name.trim()) continue
    if (s.type === 'http') {
      obj[s.name] = { type: 'http', url: s.url ?? '', env: s.env }
    } else {
      obj[s.name] = {
        type: 'stdio',
        command: s.command ?? '',
        args: s.args ?? [],
        env: s.env,
      }
    }
    if (!s.env || Object.keys(s.env).length === 0) delete obj[s.name].env
  }
  return JSON.stringify(obj, null, 2)
}
