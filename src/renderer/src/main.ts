import { createApp, watchEffect } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import i18n from './i18n'
import App from './App.vue'
import './assets/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)

// Keep the document / window title in sync with the active i18n locale.
// The static <title> in index.html is the pre-mount fallback; once Vue is
// up, this watchEffect drives it through t('app.title') so future locale
// switches update the OS window title (and the macOS Dock tooltip) too.
watchEffect(() => {
  document.title = i18n.global.t('app.title')
})

app.mount('#app')
