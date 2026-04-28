import { createI18n } from 'vue-i18n'
import zhTW from './locales/zh-TW'

// Composition API mode (legacy: false) — used as `useI18n()` inside <script
// setup>. Only zh-TW for now; adding en-US is a matter of dropping a
// matching messages object in here and exposing a locale switcher.
const i18n = createI18n({
  legacy: false,
  locale: 'zh-TW',
  fallbackLocale: 'zh-TW',
  messages: {
    'zh-TW': zhTW
  }
})

export default i18n
