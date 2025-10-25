import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import vuetify from './plugins/vuetify'
import { createPersistedStatePlugin } from './plugins/piniaPersist'
import Tres from '@tresjs/core'
import './style.css'

const app = createApp(App)

const pinia = createPinia()
pinia.use(createPersistedStatePlugin({ keyPrefix: 'harmony' }))

app.use(pinia)
app.use(router)
app.use(vuetify)
app.use(Tres)

app.mount('#app')
