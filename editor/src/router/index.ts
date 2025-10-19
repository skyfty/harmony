import { createRouter, createWebHashHistory } from 'vue-router'
import EditorView from '@/views/EditorView.vue'

const routes = [
  {
    path: '/',
    name: 'editor',
    component: EditorView,
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
