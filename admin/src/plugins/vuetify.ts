import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify_densest/css/preset.css'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import { md3 } from 'vuetify/blueprints'
import type { App } from 'vue'

const vuetify = createVuetify({
  blueprint: md3,
  theme: {
    defaultTheme: 'light',
  },
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
})

export function installVuetify(app: App<Element>): void {
  app.use(vuetify)
}
