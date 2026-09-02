import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { i18n } from './i18n'
import { router } from './router'
import { useSettingsStore } from './stores/settings'
import './styles/main.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(i18n)
app.use(router)

// 테마/언어를 첫 렌더 전에 적용해야 화면이 번쩍이지 않는다.
useSettingsStore(pinia).init()

app.mount('#app')
