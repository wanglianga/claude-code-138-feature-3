import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMuseumStore } from '@/stores/museum'
import { useReservationsStore } from '@/stores/reservations'

describe('预约全生命周期集成', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('提交→确认→到馆→发设备→入场→途中事件→离馆押金结算', () => {
    const museum = useMuseumStore()
    const store = useReservationsStore()
    museum.setNow('14:00')

    // 1. 预约方提交
    const r = store.create({
      orgType: 'enterprise',
      orgName: '测试科技有限公司',
      groupSize: 30,
      ageBand: 'adult',
      language: 'zh',
      accessible: false,
      themeId: 't_modern',
      arriveTime: '2026-10-01T14:00:00',
      contactName: '测试领队',
      contactPhone: '13800000000',
      busInfo: '大巴 1 辆',
      needHeadsets: true,
      headsetCount: 30,
      note: '',
    })
    expect(r.status).toBe('submitted')
    expect(r.route.length).toBeGreaterThan(0)
    expect(r.timeline[0].kind).toBe('submit')

    // 2. 馆方确认（林岚 09-17 当班且下午空闲）
    store.confirm(r.id, { guideIds: ['g1'], laneId: 'lane_a', batchNo: 'B1400', note: '正常确认' }, '沈姐')
    expect(r.status).toBe('confirmed')
    expect(r.assignedGuideIds).toEqual(['g1'])

    // 3. 到馆（时钟设为 14:05 → 迟到 5 分钟）
    museum.setNow('14:05')
    store.markArrived(r.id)
    expect(r.status).toBe('arrived')
    expect(r.actualArrive).toBe('2026-10-01T14:05:00')
    expect(r.timeline.some((e) => e.kind === 'arrive' && e.title.includes('迟到 5'))).toBe(true)

    // 4. 核验人数：少 2 人
    store.verifyHeadcount(r.id, 28, '小唐')
    expect(r.verifiedSize).toBe(28)

    // 5. 发耳麦
    store.handoutHeadsets(r.id, 28, '老郭')
    expect(r.devices).toHaveLength(28)
    expect(r.devices.every((d) => d.status === 'lent')).toBe(true)
    expect(r.depositTotal).toBe(28 * 200)

    // 6. 入场
    store.admit(r.id, '安检员')
    expect(r.status).toBe('touring')
    expect(r.route.some((s) => s.state === 'current')).toBe(true)
    expect(museum.inventory.lent).toBeGreaterThanOrEqual(28 + 24) // 本团 28 + 种子儿童团 24

    // 7. 迟到顺延 15 分钟
    const before = r.route.find((s) => s.state === 'planned')!.plannedEnter
    store.delay(r.id, 15, 'late', '团体迟到顺延15分钟', '', '沈姐')
    const after = r.route.find((s) => s.state === 'planned')!.plannedEnter
    expect(after > before).toBe(true)

    // 8. 改道：当前站 → h3
    const blocked = r.route.find((s) => s.state === 'current')!.hallId
    store.applyReroute(r.id, {
      blockedHallId: blocked,
      targetHallId: 'h3',
      atHM: museum.nowHM,
      durationMin: 25,
      reason: '游客对雕塑感兴趣',
    }, '林岚')
    expect(r.route.find((s) => s.hallId === 'h3' && s.state === 'current')).toBeTruthy()
    expect(r.timeline.some((e) => e.kind === 'reroute')).toBe(true)

    // 9. 儿童走散（成人团也可调用通用等待事件）
    store.childLost(r.id, '随行儿童一名', 10, true, '林岚')
    expect(r.timeline.some((e) => e.kind === 'child_lost')).toBe(true)

    // 10. 耳麦损坏换机
    const oldCode = r.devices[0].code
    store.exchangeHeadset(r.id, oldCode, '无声音', '老郭')
    expect(r.devices.find((d) => d.code === oldCode)?.status).toBe('damaged')
    expect(r.devices.filter((d) => d.status === 'lent').length).toBe(28)
    expect(r.timeline.some((e) => e.kind === 'device_exchange')).toBe(true)

    // 11. 讲解员替换：何田田下午当班且无团
    store.swapGuide(r.id, 'g1', 'g5', '林岚嗓子不适')
    expect(r.assignedGuideIds).toEqual(['g5'])

    // 12. 离馆：28 台归还，其中 1 台损坏（换机时已登记）、1 台遗失
    const results = r.devices
      .filter((d) => d.status === 'lent')
      .map((d, i) => ({ code: d.code, result: i === 0 ? ('lost' as const) : ('ok' as const) }))
    store.returnDevices(r.id, results, '老郭')
    // 27 完好 + 1 遗失 + 换机旧机损坏
    expect(r.depositDeduction).toBe(200 + 50)
    store.settleDeposit(r.id, '老郭')
    expect(r.timeline.some((e) => e.kind === 'deposit_settle' && e.amount === 250)).toBe(true)

    // 13. 完成
    store.complete(r.id, 4, '小唐')
    expect(r.status).toBe('completed')
    expect(r.satisfaction).toBe(4)
    expect(r.departAt).toBeTruthy()

    // 时间线按时间排序且覆盖关键环节
    const kinds = r.timeline.map((e) => e.kind)
    for (const k of ['submit', 'confirm', 'arrive', 'headcount', 'device_handout', 'batch_admit', 'reroute', 'device_exchange', 'guide_swap', 'device_return', 'deposit_settle', 'complete']) {
      expect(kinds).toContain(k)
    }
    const times = r.timeline.map((e) => e.at)
    expect([...times].sort()).toEqual(times)
  })

  it('临时维护会联动所有在馆/已确认团的受影响站点', () => {
    const museum = useMuseumStore()
    const store = useReservationsStore()
    museum.setNow('10:25')
    // 种子儿童团 R3 正在 h5（10:20-10:45）
    store.declareMaintenance('h5', { start: '10:00', end: '11:00', reason: '光影设备抢修' }, '工程部')
    const r3 = store.byId('R20261001-03')!
    const stop = r3.route.find((s) => s.hallId === 'h5')!
    expect(stop.state).toBe('maintenance')
    expect(museum.maintenance.h5?.reason).toBe('光影设备抢修')
  })

  it('闭展分流：筛团→批量通知→接受改道→讲解重点同步与已读', () => {
    const museum = useMuseumStore()
    const store = useReservationsStore()
    museum.setNow('10:25')
    const inc = store.declareClosure(
      { hallId: 'h5', reason: '光影投影故障', start: '10:25', expectedEnd: '11:25' },
      '工程部 老葛',
    )
    const r3 = store.byId('R20261001-03')!
    // 只有正在 h5 的儿童团被筛出
    expect(Object.keys(inc.plans)).toEqual(['R20261001-03'])
    const plan = inc.plans[r3.id]
    expect(plan.waitMin).toBe(60) // 当前站，从现在 10:25 等到复开 11:25
    expect(museum.maintenance.h5?.reason).toBe('光影投影故障')
    expect(r3.route.find((s) => s.hallId === 'h5')?.state).toBe('maintenance')

    // 批量通知
    store.notifyClosureContacts(inc.id, [r3.id], '前台主管 沈姐')
    expect(plan.notified).toBe(true)
    expect(plan.status).toBe('notified')
    expect(inc.notices).toHaveLength(1)
    expect(r3.timeline.some((e) => e.kind === 'closure_notify')).toBe(true)

    // 接受替代路线（中庭，儿童友好、容量充足）
    store.acceptClosureAlternative(inc.id, r3.id, { targetHallId: 'courtyard', durationMin: 20 }, '沈姐')
    expect(plan.status).toBe('rerouted')
    expect(plan.appliedHallId).toBe('courtyard')
    expect(r3.route.find((s) => s.hallId === 'courtyard' && s.state === 'current')).toBeTruthy()
    expect(r3.briefings).toHaveLength(1)
    expect(r3.briefings![0].guideId).toBe('g3')
    expect(r3.briefings![0].points.length).toBeGreaterThan(0)
    expect(r3.briefings![0].readAt).toBeUndefined()
    expect(r3.timeline.some((e) => e.kind === 'closure_guide')).toBe(true)

    // 讲解员端确认已读
    store.markBriefingRead(r3.id, r3.briefings![0].id)
    expect(r3.briefings![0].readAt).toBeTruthy()
    expect(r3.timeline.some((e) => e.kind === 'closure_guide_read')).toBe(true)
  })

  it('闭展分流：无障碍大团可换亲子主题；拒绝替代路线按 50% 部分退款；结束闭展解除维护', () => {
    const museum = useMuseumStore()
    const store = useReservationsStore()
    museum.setNow('11:05')
    const inc = store.declareClosure(
      { hallId: 'h2', reason: '书画展柜恒温设备故障', start: '11:05', expectedEnd: '12:00' },
      '工程部 老葛',
    )
    const r4 = store.byId('R20261001-04')! // 55 人无障碍团，11:10 到二号厅
    const plan = inc.plans[r4.id]
    expect(plan).toBeTruthy()
    // 何田田可讲亲子线，且亲子线展厅均无障碍可达
    expect(plan.themeSwitchable).toBe(true)
    expect(plan.altThemeIds).toContain('t_family')

    // 拒绝 → 部分退款 50%：55 × ¥20 × 50% = ¥550
    store.refuseClosureAlternative(inc.id, r4.id, 'refund', { refundRatio: 50 }, '沈姐')
    expect(plan.status).toBe('refunded')
    expect(r4.refunds).toHaveLength(1)
    expect(r4.refunds![0].amount).toBe(550)
    expect(r4.timeline.some((e) => e.kind === 'partial_refund' && e.amount === 550)).toBe(true)

    // 结束闭展：展厅恢复、事件归档、团队时间线补 closure_update
    store.resolveClosure(inc.id, '12:00', '恒温设备已更换', '工程部 老葛')
    expect(museum.incidentById(inc.id)?.status).toBe('resolved')
    expect(museum.maintenance.h2).toBeUndefined()
    expect(r4.timeline.some((e) => e.kind === 'closure_update')).toBe(true)
  })

  it('闭展分流：团队拒绝替代路线可改期，预约状态转「改期待约」', () => {
    const museum = useMuseumStore()
    const store = useReservationsStore()
    museum.setNow('10:35')
    const inc = store.declareClosure(
      { hallId: 'h1', reason: '海派厅照明故障', start: '10:30', expectedEnd: '11:05' },
      '工程部 老葛',
    )
    const r2 = store.byId('R20261001-02')! // 英语团 10:40 进一号厅
    expect(inc.plans[r2.id]).toBeTruthy()
    store.refuseClosureAlternative(
      inc.id,
      r2.id,
      'reschedule',
      { rescheduleTo: '2026-10-08T10:30:00', reason: '外宾团行程冲突，要求改期' },
      '沈姐',
    )
    expect(inc.plans[r2.id].status).toBe('rescheduled')
    expect(r2.status).toBe('rescheduled')
    expect(r2.rescheduledTo).toBe('2026-10-08T10:30:00')
    expect(r2.timeline.some((e) => e.kind === 'reschedule')).toBe(true)
  })
})
