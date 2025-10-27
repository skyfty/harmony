/// <reference path="./typings/global.d.ts" />

App({
  globalData: {
    sceneManifests: [] as Array<{ id: string; name: string }>,
  },
  onLaunch() {
    console.info('Harmony scene viewer mini program launched')
  },
})
