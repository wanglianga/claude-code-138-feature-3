import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/board' },
    { path: '/book', name: 'book', component: () => import('@/views/BookView.vue'), meta: { title: '团体预约' } },
    { path: '/reservations', name: 'reservations', component: () => import('@/views/ReservationsView.vue'), meta: { title: '全部预约' } },
    { path: '/confirm/:id?', name: 'confirm', component: () => import('@/views/ConfirmView.vue'), meta: { title: '预约确认台' } },
    { path: '/front/:id?', name: 'front', component: () => import('@/views/FrontDeskView.vue'), meta: { title: '到馆前台' } },
    { path: '/dispatch', name: 'dispatch', component: () => import('@/views/DispatchView.vue'), meta: { title: '途中分流调度' } },
    { path: '/closure', name: 'closure', component: () => import('@/views/ClosureView.vue'), meta: { title: '临时闭展分流' } },
    { path: '/checkout/:id?', name: 'checkout', component: () => import('@/views/CheckoutView.vue'), meta: { title: '离馆核销' } },
    { path: '/trace/:id?', name: 'trace', component: () => import('@/views/TraceView.vue'), meta: { title: '投诉追溯' } },
    { path: '/board', name: 'board', component: () => import('@/views/OpsView.vue'), meta: { title: '运营看板' } },
  ],
})
