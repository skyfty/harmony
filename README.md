# Harmony 3D Scene Editor (Vite + Vue + Vuetify + Three.js)

Harmony is a Unity-inspired scene editor scaffolded with Vite, Vue 3, Vuetify, and Three.js. It provides a foundation for building interactive 3D creation tools inside the browser, complete with hierarchy, inspector, and project management panels.

## 🚀 Quick start

```bash
npm install
npm run dev

# production build
npm run build
```

The dev server runs on port `5173` by default. When it starts, open the printed URL in your browser.

## 🧭 Editor layout

- **Hierarchy (left)** – browse the scene graph and select nodes. Panels can be collapsed via the header button or the edge toggles.
- **Scene View (center)** – renders a Three.js scene with gizmos for Select, Move, Rotate, and Scale. Orbit with LMB drag, pan with RMB drag, and zoom with the scroll wheel. Use the toolbar to swap transform modes.
- **Inspector (right)** – inspect and edit the selected node’s transform and basic material properties (color, opacity, wireframe).
- **Project (bottom)** – navigate mock asset directories and drop assets into the scene. Selecting an asset highlights it; “Add to Scene” instantiates a matching mesh using the asset’s preview color.

## 🧩 Key features

- Vuetify-driven Unity-style shell with collapsible panels and responsive styling.
- Three.js integration with orbit and transform controls wired to Pinia state.
- Live synchronization between the viewport, hierarchy, and inspector panels.
- Mock project browser with directory tree, asset thumbnails, and one-click instancing.
- Strong TypeScript typings for scene graph entities and editor state.

## 📂 Project structure highlights

- `src/stores/sceneStore.ts` – centralized Pinia store for nodes, selection, tools, and assets.
- `src/components/editor/SceneViewport.vue` – Three.js renderer and gizmo logic.
- `src/components/layout/*.vue` – panel components for hierarchy, inspector, and project management.
- `src/types/scene.ts` – reusable scene graph typings.

## 🔮 Next steps & ideas

- Persist scene data to disk or remote storage.
- Extend asset handling to load actual models/textures.
- Enrich inspector with component-based editing and validation.
- Add undo/redo history and keyboard shortcuts.

## 🛠️ Tooling versions

- Node 18+
- Vue 3.5
- Vuetify 3.10
- Three.js 0.180
- Vite 7

Happy hacking! 🎛️
