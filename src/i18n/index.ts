import * as vscode from 'vscode'
import strings from './strings.json'

export type Locale = 'ru' | 'en'
export type LocaleSetting = 'auto' | 'ru' | 'en'

type Dict = Record<string, Record<Locale, string>>
const dict = strings as Dict

/** Resolve `auto` → effective locale based on VSCode UI language. */
export function resolveLocale(setting: LocaleSetting): Locale {
  if (setting === 'ru' || setting === 'en') return setting
  return vscode.env.language.startsWith('ru') ? 'ru' : 'en'
}

/** Translate a key for the given locale. Optional `{key}` interpolation. */
export function t(key: string, locale: Locale, params?: Record<string, string | number>): string {
  const entry = dict[key]
  const raw = entry?.[locale] ?? entry?.en ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (_m, k) => String(params[k] ?? ''))
}
