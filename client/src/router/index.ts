import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    {
      path: '/project/:name',
      name: 'project',
      component: () => import('@/pages/ProjectPage.vue'),
    },
  ],
})

export default router
