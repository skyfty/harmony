import { createRouter, createWebHashHistory } from 'vue-router'
import EditorView from '@/views/EditorView.vue'
import ScenePreviewView from '@/views/ScenePreviewView.vue'

const routes = [
  {
    path: '/',
    name: 'editor',
    component: EditorView,
  },
  {
    path: '/preview',
    name: 'scene-preview',
    component: ScenePreviewView,
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
