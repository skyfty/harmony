import { createRouter, createWebHashHistory } from 'vue-router'
import LoadView from '@/views/LoadView.vue'
import ScenePreviewView from '@/views/ScenePreviewView.vue'
import kk from '@/views/kk.vue'

const routes = [
  {
    path: '/',
    name: 'loader',
    component: LoadView,
  },
  {
    path: '/preview',
    name: 'scene-preview',
    component: ScenePreviewView,
  },
  {
    path: '/kk',
    name: 'kk',
    component: kk,
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
