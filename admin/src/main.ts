import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { installVuetify } from './plugins/vuetify'
import { useAuthStore } from './stores/auth'
import './assets/main.scss'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
installVuetify(app)
app.use(router)

const authStore = useAuthStore()
authStore.bootstrapFromStorage()

router.isReady().then(() => {
  app.mount('#app')
})
