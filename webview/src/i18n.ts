import { createContext, useContext } from 'react'
import strings from '../../src/i18n/strings.json'

export type Locale = 'ru' | 'en'
type Dict = Record<string, Record<Locale, string>>
const dict = strings as Dict

export function translate(
  key: string,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const entry = dict[key]
  const raw = entry?.[locale] ?? entry?.en ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (_m, k) => String(params[k] ?? ''))
}

export const LocaleContext = createContext<Locale>('en')

export function useT() {
  const locale = useContext(LocaleContext)
  return (key: string, params?: Record<string, string | number>) =>
    translate(key, locale, params)
}
