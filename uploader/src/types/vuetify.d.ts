declare module 'vuetify/styles' {
  const content: never
  export default content
}

declare module 'vuetify/blueprints' {
  import type { Blueprint } from 'vuetify'
  export const md3: Blueprint
}

declare module 'vuetify/iconsets/mdi' {
  import type { IconAliases, IconSet } from 'vuetify'
  export const aliases: IconAliases
  export const mdi: IconSet
}
