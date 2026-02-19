declare module 'vue-i18n' {
  export function useI18n(): {
    t: (key: string, ...args: unknown[]) => string;
  };
}
