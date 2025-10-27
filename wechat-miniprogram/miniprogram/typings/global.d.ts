/// <reference types="miniprogram-api-typings" />

export {}

declare global {
  interface IAppOption {
    globalData: {
      sceneManifests: Array<{ id: string; name: string }>
    }
  }
}
