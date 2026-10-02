// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mount } from '@vue/test-utils'
import BookView from '@/views/BookView.vue'
import ReservationsView from '@/views/ReservationsView.vue'
import ConfirmView from '@/views/ConfirmView.vue'
import FrontDeskView from '@/views/FrontDeskView.vue'
import DispatchView from '@/views/DispatchView.vue'
import ClosureView from '@/views/ClosureView.vue'
import CheckoutView from '@/views/CheckoutView.vue'
import TraceView from '@/views/TraceView.vue'
import OpsView from '@/views/OpsView.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/book', component: BookView },
      { path: '/confirm/:id?', component: ConfirmView },
      { path: '/front/:id?', component: FrontDeskView },
      { path: '/dispatch', component: DispatchView },
      { path: '/closure', component: ClosureView },
      { path: '/checkout/:id?', component: CheckoutView },
      { path: '/trace/:id?', component: TraceView },
      { path: '/board', component: OpsView },
    ],
  })
}

async function mountView(component: unknown, initialPath = '/') {
  const router = makeRouter()
  // 先导航（深链参数需在 setup 前就绪），再挂载；根路径无需导航
  if (initialPath !== '/') await router.push(initialPath)
  return mount(component as never, {
    global: { plugins: [router] },
  })
}

describe('九大业务视图挂载冒烟', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('运营看板渲染展厅、讲解员表与闭展复盘', async () => {
    const w = await mountView(OpsView, '/board')
    expect(w.text()).toContain('展厅实时负载')
    expect(w.text()).toContain('讲解员排班')
    expect(w.text()).toContain('临时闭展分流与运营复盘')
    expect(w.text()).toContain('投诉率')
  })

  it('预约表单渲染全部必填字段', async () => {
    const w = await mountView(BookView)
    expect(w.text()).toContain('团体人数')
    expect(w.text()).toContain('讲解主题')
    expect(w.text()).toContain('无障碍路线')
    expect(w.text()).toContain('车辆停靠')
    expect(w.text()).toContain('借用')
  })

  it('预约列表渲染种子数据', async () => {
    const w = await mountView(ReservationsView)
    expect(w.text()).toContain('云川中学')
    expect(w.text()).toContain('星辉国际旅行社')
  })

  it('确认台展示容量、讲解员与安检校验', async () => {
    const w = await mountView(ConfirmView)
    expect(w.text()).toContain('展厅容量与临时闭展校验')
    expect(w.text()).toContain('讲解员排班匹配')
    expect(w.text()).toContain('安检通道')
  })

  it('到馆前台四步流程', async () => {
    const w = await mountView(FrontDeskView)
    expect(w.text()).toContain('到馆登记')
    expect(w.text()).toContain('核验人数')
    expect(w.text()).toContain('发放耳麦')
    expect(w.text()).toContain('批次安检入馆')
  })

  it('途中调度页展示七类事件入口与实时态势', async () => {
    const w = await mountView(DispatchView)
    expect(w.text()).toContain('展厅实时态势')
    expect(w.text()).toContain('展厅拥堵分流')
    expect(w.text()).toContain('儿童走散')
    expect(w.text()).toContain('耳麦损坏换机')
    expect(w.text()).toContain('讲解员临时替换')
    expect(w.text()).toContain('游客要求改路线')
    expect(w.text()).toContain('展厅临时维护')
  })

  it('临时闭展分流台渲染已结束案例、受影响团队与讲解员端', async () => {
    const w = await mountView(ClosureView, '/closure')
    expect(w.text()).toContain('登记设备故障闭展')
    expect(w.text()).toContain('博远教育研学营')
    expect(w.text()).toContain('北辰国际交流团')
    expect(w.text()).toContain('批量通知')
    expect(w.text()).toContain('讲解重点')
  })

  it('离馆核销页渲染设备清点与押金结算', async () => {
    const w = await mountView(CheckoutView)
    expect(w.text()).toContain('逐台核对耳麦归还')
    expect(w.text()).toContain('押金结算')
    expect(w.text()).toContain('满意度')
  })

  it('追溯页渲染晨光职校投诉档案证据链', async () => {
    const w = await mountView(TraceView, '/trace/R20261001-05')
    expect(w.text()).toContain('晨光职业学校')
    expect(w.text()).toContain('讲解缩水')
    expect(w.text()).toContain('完整操作时间线')
  })

  it('追溯页渲染闭展团的分流处置与部分退款证据', async () => {
    const w = await mountView(TraceView, '/trace/R20261001-06')
    expect(w.text()).toContain('临时闭展分流处置')
    expect(w.text()).toContain('拒绝替代路线')
    expect(w.text()).toContain('¥200')
  })
})
