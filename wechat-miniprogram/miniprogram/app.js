"use strict";
/// <reference path="./typings/global.d.ts" />
App({
    globalData: {
      /** @type {Array<{ id: string, name: string }>} */
      sceneManifests: [],
    },
    onLaunch() {
        console.info('Harmony scene viewer mini program launched');
    },
});
