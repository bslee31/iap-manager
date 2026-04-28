import zhTW from './locales/zh-TW'

// Main-process i18n. Mirrors the renderer's vue-i18n setup but is a tiny
// hand-rolled lookup because vue-i18n is renderer-only and pulling
// @intlify/core into the main bundle is overkill for a few hundred keys.
//
// Locale defaults to zh-TW. When we add en-US, the renderer will own the
// locale switch UI and can push the choice over IPC via setLocale() so
// that error / validation / phase strings emitted from main match what
// the user sees in the renderer.

type Messages = typeof zhTW
const dictionaries: Record<string, Messages> = {
  'zh-TW': zhTW
}

let currentLocale: keyof typeof dictionaries = 'zh-TW'

export function setLocale(locale: string): void {
  if (locale in dictionaries) {
    currentLocale = locale as keyof typeof dictionaries
  }
}

export function getLocale(): string {
  return currentLocale
}

// Resolve a dot-separated key against the active dictionary, then
// substitute `{name}` placeholders from `params`. Returns the key itself
// if the lookup misses — a visible fallback that surfaces dictionary gaps
// instead of silently swallowing them.
export function t(key: string, params?: Record<string, string | number>): string {
  const parts = key.split('.')
  let value: unknown = dictionaries[currentLocale]
  for (const part of parts) {
    if (typeof value !== 'object' || value === null) return key
    value = (value as Record<string, unknown>)[part]
  }
  if (typeof value !== 'string') return key
  if (!params) return value
  return value.replace(/\{(\w+)\}/g, (_, name) =>
    name in params ? String(params[name]) : `{${name}}`
  )
}
