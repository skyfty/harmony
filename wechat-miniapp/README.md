# Harmony WeChat Mini Program

WeChat mini program used to preview Harmony editor scenes exported as JSON bundles.

## Features

- Import bundle JSON files from local device or remote URL.
- Deduplicate scenes via their `id` and show them in a selectable list.
- Preload embedded assets (including resources encoded with `exportOptions.embedResources=true`) and display a progress bar.
- Rebuild the scene with Three.js, including support for preset geometry, ground meshes, materials, textures, lights, and GLTF assets.
- Navigate the scene with first-person touch controls (left side joystick for movement, right side swipe for looking around).

## Getting Started

1. Install dependencies in the `wechat-miniapp` folder and generate the `miniprogram_npm` directory:

   ```bash
   cd wechat-miniapp
   npm install
   npx miniprogram-npm build
   ```

   The project depends on the official [`threejs-miniprogram`](https://github.com/wechat-miniprogram/threejs-miniprogram) package. If WeChat updates the package name or version, adjust `package.json` accordingly.

2. Open the project with WeChat Developer Tools and select the `wechat-miniapp` directory as the project root. Use the provided `touristappid` or configure your own AppID.

3. Export a scene from the Harmony editor with `embedResources` enabled (already the default for `exportCurrentScene`). Drop the JSON file into the mini program via the **导入本地文件** button or host it and load it through the URL input.

4. Select a scene from the list to preview it. The progress overlay tracks resource decoding and GLTF parsing. Use the left side of the canvas for movement and the right side for look controls.

## Notes

- Embedded resources are written into the mini program sandbox at `wx.env.USER_DATA_PATH/harmony-assets`. The loader reuses cached files on subsequent loads.
- Scenes that reference remote assets without embedding will be fetched over the network using `downloadUrl` or `description` fields from the asset catalog when available.
- The loader supports GLTF/GLB meshes via `GLTFLoader`, basic primitives (Box, Sphere, etc.), and ground dynamic meshes. Extend `utils/scene-builder.js` for additional node types as needed.
- To clear cached assets, remove the `harmony-assets` directory in the simulator storage panel of WeChat Developer Tools.
