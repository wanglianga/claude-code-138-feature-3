import { describe, expect, it } from 'vitest'
import {
  affectedByIncident,
  incidentStats,
  reopenEnterHM,
  suggestRefund,
  switchableThemes,
  talkingPoints,
  waitEstimateMin,
} from './closure'
import { GUIDES, HALLS, THEMES } from '@/data/museum'
import { seedClosures, seedReservations } from '@/data/seed'
import type { ClosureIncident, Reservation } from '@/types'

const reservations = seedReservations()
const byId = (id: string) => reservations.find((r) => r.id === id)!

function inc(partial: Partial<ClosureIncident>): ClosureIncident {
  return {
    id: 'INC-T',
    hallId: 'h5',
    start: '10:25',
    end: '11:30',
    reason: '光影设备故障',
    category: 'equipment',
    status: 'active',
    createdAt: '2026-10-01T10:25:00',
    createdBy: '测试',
    ...partial,
  }
}

describe('affectedByIncident 从当日预约筛出受影响团队', () => {
  it('五号厅闭展：筛出参观中的儿童团与待确认的云川中学', () => {
    const out = affectedByIncident(reservations, inc({}))
    const ids = out.map((x) => x.reservation.id)
    expect(ids).toContain('R20261001-03') // touring，h5 current
    expect(ids).toContain('R20261001-01') // submitted，h5 planned 10:50-11:15
    expect(ids).toHaveLength(2)
  })

  it('一号厅闭展：筛中已确认的星辉国旅；已离馆团队不受影响', () => {
    const out = affectedByIncident(reservations, inc({ hallId: 'h1', start: '10:30', end: '11:30' }))
    expect(out.map((x) => x.reservation.id)).toEqual(['R20261001-02'])
  })

  it('已完成/已跳过/已按闭展处置的站点不重复筛出', () => {
    // R5 已离馆且 h1 站已 done
    const out = affectedByIncident(reservations, inc({ hallId: 'h1', start: '08:30', end: '09:30' }))
    expect(out).toHaveLength(0)
    // 把 R1 的 h5 站标记为维护后，不再被筛出
    const cloned = seedReservations()
    const r1 = cloned.find((r) => r.id === 'R20261001-01')!
    r1.route.find((s) => s.hallId === 'h5')!.state = 'maintenance'
    const out2 = affectedByIncident(cloned, inc({}))
    expect(out2.map((x) => x.reservation.id)).toEqual(['R20261001-03'])
  })

  it('计划窗口不与闭展时段重叠的团队不受影响', () => {
    // R4 远瞻科技 h2 11:10-11:35；闭展 09:00-10:00 不重叠
    const out = affectedByIncident(reservations, inc({ hallId: 'h2', start: '09:00', end: '10:00' }))
    expect(out).toHaveLength(0)
  })
})

describe('waitEstimateMin / reopenEnterHM 预计等待', () => {
  it('等待 = 闭展结束 + 5 分钟缓冲 − max(当前, 计划进场)', () => {
    const r1 = byId('R20261001-01')
    const stop = r1.route.find((s) => s.hallId === 'h5')! // 计划 10:50 进场
    expect(waitEstimateMin(inc({}), stop, '10:25')).toBe(45) // 11:35 - 10:50
    expect(reopenEnterHM(inc({}))).toBe('11:35')
  })

  it('正在厅内的团队从当前时刻起算等待', () => {
    const r3 = byId('R20261001-03')
    const stop = r3.route.find((s) => s.hallId === 'h5')! // actualEnter 10:20
    expect(waitEstimateMin(inc({}), stop, '10:40')).toBe(55) // 11:35 - 10:40
  })
})

describe('switchableThemes 是否可换讲解主题', () => {
  const live = { h5: { start: '10:25', end: '11:30', reason: '光影设备故障' } }

  it('儿童团可换雕塑线（苏晓会讲，中庭开放），不可换讲解员不会的主题', () => {
    const r3 = byId('R20261001-03')
    const out = switchableThemes(r3, THEMES, HALLS, live, GUIDES, '10:25')
    expect(out.map((x) => x.theme.id)).toEqual(['t_sculpture'])
    expect(out[0].coverGuides.map((g) => g.name)).toContain('苏晓')
    expect(out[0].hallNames).toEqual(['公共艺术区'])
  })

  it('含闭展厅或窗口内维护展厅的主题被排除', () => {
    const r1 = byId('R20261001-01') // 待确认，未派讲解员
    const out = switchableThemes(r1, THEMES, HALLS, live, GUIDES, '10:25')
    const ids = out.map((x) => x.theme.id)
    expect(ids).not.toContain('t_sculpture') // 含 h5 闭展
    expect(ids).not.toContain('t_west') // 含 h7 11:00-12:00 维护
    expect(ids).toContain('t_master')
    expect(ids).toContain('t_modern')
  })

  it('无障碍团队只能换全部可达的主题', () => {
    const r4 = byId('R20261001-04') // accessible，t_master 含 h4 不可达
    const out = switchableThemes(r4, THEMES, HALLS, {}, GUIDES, '10:25')
    for (const x of out) {
      const remaining = x.theme.hallIds.filter((h) => !['h2', 'h6'].includes(h))
      for (const hid of remaining) {
        expect(HALLS.find((h) => h.id === hid)!.accessible).toBe(true)
      }
    }
    expect(out.map((x) => x.theme.id)).not.toContain('t_modern') // 含 h4 无无障碍
  })
})

describe('suggestRefund 部分退款估算', () => {
  it('按 单价 × 人数 × 未参观时长占比 计算', () => {
    const r3 = byId('R20261001-03') // h5 站 25 分钟 / 总 75 分钟，24 人
    const s = suggestRefund(r3, 'h5')
    expect(s.missedMin).toBe(25)
    expect(s.size).toBe(24)
    expect(s.amount).toBe(Math.round(40 * 24 * (25 / 75))) // 320
  })

  it('退款占比封顶 50%', () => {
    const fake = {
      ...byId('R20261001-01'),
      verifiedSize: 10,
      durationMin: 40,
      route: [
        { hallId: 'h5', plannedEnter: '10:00', plannedLeave: '10:40', durationMin: 40, state: 'planned' as const },
      ],
    } as Reservation
    const s = suggestRefund(fake, 'h5')
    expect(s.ratio).toBe(0.5)
    expect(s.amount).toBe(40 * 10 * 0.5)
  })
})

describe('talkingPoints 讲解重点', () => {
  it('一号厅：热门展品重点讲解 + 禁拍提醒 + 安静提示', () => {
    const pts = talkingPoints(HALLS.find((h) => h.id === 'h1')!, byId('R20261001-02'))
    expect(pts.some((p) => p.includes('《风雨归舟图》'))).toBe(true)
    expect(pts.some((p) => p.includes('禁拍'))).toBe(true)
    expect(pts.some((p) => p.includes('安静'))).toBe(true)
  })

  it('儿童团在儿童友好展厅提示互动停留；无障碍团提示轮椅动线', () => {
    const h3 = HALLS.find((h) => h.id === 'h3')!
    expect(talkingPoints(h3, byId('R20261001-03')).some((p) => p.includes('儿童友好'))).toBe(true)
    expect(talkingPoints(h3, byId('R20261001-04')).some((p) => p.includes('轮椅'))).toBe(true)
  })
})

describe('incidentStats 闭展复盘统计', () => {
  it('种子事件：晨光职校被改线，投诉率 100%，满意度 3', () => {
    const { records } = seedClosures()
    const stats = incidentStats(records, reservations)
    expect(stats.affected).toBe(1)
    expect(stats.rerouted).toBe(1)
    expect(stats.complaints).toBe(1)
    expect(stats.complaintRate).toBe(1)
    expect(stats.avgSatisfaction).toBe(3)
    expect(stats.refundSum).toBe(0)
  })

  it('纯投诉登记不计入被改线团队', () => {
    const { records } = seedClosures()
    const extra = [
      ...records,
      {
        id: 'DIV-X',
        incidentId: 'INC-SEED-01',
        resId: 'R20261001-02',
        status: 'done' as const,
        decision: 'complaint' as const,
      },
    ]
    const stats = incidentStats(extra, reservations)
    expect(stats.affected).toBe(2)
    expect(stats.rerouted).toBe(1) // 投诉登记不算改线
  })
})
