import { createRouter, createWebHashHistory } from 'vue-router'
import LoadView from '@/views/LoadView.vue'
import ScenePreviewView from '@/views/ScenePreviewView.vue'
import ProjectManagerView from '@/views/ProjectManagerView.vue'

const routes = [
  {
    path: '/',
    name: 'project-manager',
    component: ProjectManagerView,
  },
  {
    path: '/editor',
    name: 'loader',
    component: LoadView,
  },
  {
    path: '/preview',
    name: 'scene-preview',
    component: ScenePreviewView,
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
