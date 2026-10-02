import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMuseumStore } from '@/stores/museum'
import { useReservationsStore } from '@/stores/reservations'
import { useClosuresStore } from '@/stores/closures'
import { incidentStats } from '@/lib/closure'

describe('展厅临时闭展分流 · 全流程集成', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function declareH5() {
    const museum = useMuseumStore()
    const closures = useClosuresStore()
    museum.setNow('10:25')
    const inc = closures.declareIncident(
      { hallId: 'h5', start: '10:25', end: '11:30', reason: '光影互动墙设备故障', category: 'equipment' },
      '前台主管 沈姐',
    )
    return inc
  }

  it('登记闭展：联动全局维护状态，并筛出受影响团队生成处置记录', () => {
    const museum = useMuseumStore()
    const closures = useClosuresStore()
    const inc = declareH5()
    expect(museum.maintenance.h5?.reason).toBe('光影互动墙设备故障')
    const records = closures.recordsOf(inc.id)
    const resIds = records.map((r) => r.resId).sort()
    expect(resIds).toEqual(['R20261001-01', 'R20261001-03']) // 待确认 + 参观中
    expect(records.every((r) => r.status === 'pending')).toBe(true)
  })

  it('批量通知：通知内容写入各预约时间线，记录置为已通知', () => {
    const store = useReservationsStore()
    const closures = useClosuresStore()
    const inc = declareH5()
    closures.notify(inc.id, ['R20261001-01', 'R20261001-03'], '前台主管 沈姐')
    for (const id of ['R20261001-01', 'R20261001-03']) {
      const r = store.byId(id)!
      const ev = r.timeline.find((e) => e.kind === 'closure_notice')
      expect(ev).toBeTruthy()
      expect(ev!.detail).toContain('五号厅')
      expect(ev!.detail).toContain('设备故障')
      expect(closures.recordFor(inc.id, id)?.status).toBe('notified')
    }
  })

  it('接受替代路线：插入替代展厅，闭展站点标记维护，后续顺延', () => {
    const store = useReservationsStore()
    const closures = useClosuresStore()
    const inc = declareH5()
    closures.decide(inc.id, 'R20261001-03', { decision: 'accept_alt', targetHallId: 'courtyard', durationMin: 25 }, '沈姐')
    const r3 = store.byId('R20261001-03')!
    const h5 = r3.route.find((s) => s.hallId === 'h5')!
    expect(h5.state).toBe('maintenance')
    expect(h5.actualLeave).toBe('10:25') // 在厅团队立即离厅
    const alt = r3.route.find((s) => s.hallId === 'courtyard')!
    expect(alt.state).toBe('current')
    expect(alt.plannedEnter).toBe('10:25')
    const rec = closures.recordFor(inc.id, 'R20261001-03')!
    expect(rec.status).toBe('done')
    expect(rec.decision).toBe('accept_alt')
    expect(rec.altHallId).toBe('courtyard')
    // 分流事件进入时间线
    expect(r3.timeline.some((e) => e.kind === 'diversion')).toBe(true)
  })

  it('未到馆团队接受替代路线：替代站保持计划状态', () => {
    const store = useReservationsStore()
    const closures = useClosuresStore()
    const inc = declareH5()
    closures.decide(inc.id, 'R20261001-01', { decision: 'accept_alt', targetHallId: 'h3', durationMin: 25 }, '沈姐')
    const r1 = store.byId('R20261001-01')!
    const alt = r1.route.find((s) => s.hallId === 'h3' && s.note?.includes('闭展替代'))
    expect(alt).toBeTruthy()
    expect(alt!.state).toBe('planned')
    expect(r1.route.find((s) => s.hallId === 'h5')!.state).toBe('maintenance')
  })

  it('等待恢复开放：受影响站点顺延到恢复时刻，后续联动', () => {
    const store = useReservationsStore()
    const closures = useClosuresStore()
    const inc = declareH5()
    closures.decide(inc.id, 'R20261001-01', { decision: 'wait_reopen' }, '沈姐')
    const r1 = store.byId('R20261001-01')!
    const h5 = r1.route.find((s) => s.hallId === 'h5')!
    expect(h5.plannedEnter).toBe('11:35') // 11:30 恢复 + 5 分钟缓冲
    expect(h5.plannedLeave).toBe('12:00')
    const edu = r1.route.find((s) => s.hallId === 'edu')!
    expect(edu.plannedEnter).toBe('12:05')
    expect(closures.recordFor(inc.id, 'R20261001-01')!.waitMin).toBe(45)
  })

  it('更换讲解主题：闭展站终止，剩余路线按新主题重排', () => {
    const store = useReservationsStore()
    const closures = useClosuresStore()
    const inc = declareH5()
    closures.decide(inc.id, 'R20261001-03', { decision: 'theme_switch', themeId: 't_sculpture' }, '沈姐')
    const r3 = store.byId('R20261001-03')!
    expect(r3.themeId).toBe('t_sculpture')
    const h5 = r3.route.find((s) => s.hallId === 'h5')!
    expect(h5.state).toBe('maintenance') // 闭展站保留为历史
    expect(r3.route.some((s) => s.hallId === 'courtyard')).toBe(true)
    expect(r3.route.some((s) => s.hallId === 'edu')).toBe(false) // 旧主题站点已替换
    expect(r3.timeline.some((e) => e.kind === 'theme_switch')).toBe(true)
  })

  it('拒绝替代路线 → 部分退款：累计退款、站点终止、金额留痕', () => {
    const store = useReservationsStore()
    const closures = useClosuresStore()
    const inc = declareH5()
    closures.decide(inc.id, 'R20261001-03', { decision: 'refund', amount: 320 }, '沈姐')
    const r3 = store.byId('R20261001-03')!
    expect(r3.refundTotal).toBe(320)
    expect(r3.route.find((s) => s.hallId === 'h5')!.state).toBe('maintenance')
    const ev = r3.timeline.find((e) => e.kind === 'refund')
    expect(ev?.amount).toBe(320)
    expect(closures.recordFor(inc.id, 'R20261001-03')!.refundAmount).toBe(320)
  })

  it('拒绝替代路线 → 改期：原预约取消并生成新日期预约', () => {
    const store = useReservationsStore()
    const closures = useClosuresStore()
    const inc = declareH5()
    const before = store.list.length
    closures.decide(inc.id, 'R20261001-01', { decision: 'reschedule', newArriveISO: '2026-10-02T10:20' }, '沈姐')
    const old = store.byId('R20261001-01')!
    expect(old.status).toBe('cancelled')
    expect(store.list.length).toBe(before + 1)
    const rec = closures.recordFor(inc.id, 'R20261001-01')!
    const nr = store.byId(rec.newResId!)!
    expect(nr.status).toBe('submitted')
    expect(nr.arriveTime).toBe('2026-10-02T10:20')
    expect(nr.rescheduleOf).toBe('R20261001-01')
    expect(nr.route.length).toBeGreaterThan(0)
    expect(nr.timeline.some((e) => e.title.includes('改期预约已生成'))).toBe(true)
  })

  it('拒绝替代路线 → 投诉登记：投诉入档，站点终止', () => {
    const store = useReservationsStore()
    const closures = useClosuresStore()
    const inc = declareH5()
    closures.decide(inc.id, 'R20261001-01', { decision: 'complaint', text: '闭展未提前通知，要求说明' }, '沈姐')
    const r1 = store.byId('R20261001-01')!
    expect(r1.complaint).toBe('闭展未提前通知，要求说明')
    expect(r1.route.find((s) => s.hallId === 'h5')!.state).toBe('maintenance')
    expect(r1.timeline.some((e) => e.kind === 'complaint')).toBe(true)
  })

  it('讲解员同步讲解重点：知晓后写入时间线', () => {
    const store = useReservationsStore()
    const closures = useClosuresStore()
    const inc = declareH5()
    closures.decide(inc.id, 'R20261001-03', { decision: 'accept_alt', targetHallId: 'courtyard', durationMin: 25 }, '沈姐')
    expect(closures.pendingGuideAck('R20261001-03')).toHaveLength(1)
    closures.ackByGuide(inc.id, 'R20261001-03', '苏晓')
    expect(closures.pendingGuideAck('R20261001-03')).toHaveLength(0)
    expect(store.byId('R20261001-03')!.timeline.some((e) => e.kind === 'guide_ack' && e.title.includes('苏晓'))).toBe(true)
  })

  it('恢复开放：解除全馆维护联动，事件进入复盘并统计投诉率/满意度', () => {
    const museum = useMuseumStore()
    const store = useReservationsStore()
    const closures = useClosuresStore()
    const inc = declareH5()
    closures.decide(inc.id, 'R20261001-03', { decision: 'refund', amount: 320 }, '沈姐')
    // 团队离馆时登记投诉与满意度
    store.addComplaint('R20261001-03', '闭展导致行程缩水', '孙老师')
    store.byId('R20261001-03')!.satisfaction = 2
    closures.resolveIncident(inc.id, '沈姐')
    expect(museum.maintenance.h5).toBeUndefined()
    expect(closures.incidentById(inc.id)?.status).toBe('resolved')
    const stats = incidentStats(closures.recordsOf(inc.id), store.list)
    expect(stats.rerouted).toBe(1)
    expect(stats.complaintRate).toBe(1)
    expect(stats.avgSatisfaction).toBe(2)
    expect(stats.refundSum).toBe(320)
    // 复盘结论 + 展厅预警说明
    closures.saveReview(inc.id, '光影设备老化，已安排更换；高峰前加巡检。', '运营 王老师')
    expect(closures.incidentById(inc.id)?.review).toContain('光影设备老化')
    museum.setHallWarning('h5', '光影设备老旧，高峰可能临时限流')
    expect(museum.hallWarnings.h5).toContain('限流')
  })
})
