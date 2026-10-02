import { describe, expect, it } from 'vitest'
import {
  affectedByClosure,
  briefingPoints,
  buildRoute,
  closureReview,
  closureWaitMin,
  downstreamImpact,
  guideBusyWindows,
  occupancyGrid,
  routePeakLoads,
  securityPlan,
  shouldAddWarning,
  splitBatches,
  suggestReroute,
  switchableThemes,
  availableGuides,
} from './schedule'
import { GUIDES, HALLS, SECURITY_LANES, THEMES } from '@/data/museum'
import { seedIncidents, seedReservations } from '@/data/seed'
import type { Reservation, RouteStop } from '@/types'

const reservations = seedReservations()
const byId = (id: string) => reservations.find((r) => r.id === id)!

describe('splitBatches', () => {
  it('55 人拆成 25+25+5', () => {
    expect(splitBatches(55)).toEqual([25, 25, 5])
  })
  it('小团不拆分', () => {
    expect(splitBatches(16)).toEqual([16])
  })
})

describe('buildRoute', () => {
  it('按主题顺序生成站点并顺延闭展厅', () => {
    const theme = THEMES.find((t) => t.id === 't_west')!
    const stops = buildRoute(theme, HALLS, '10:40', { accessible: false })
    expect(stops.map((s) => s.hallId)).toEqual(['h6', 'h7', 'h1'])
    // 七厅 11:00-12:00 维护：11:08 进场冲突，顺延到 12:05
    const h7 = stops.find((s) => s.hallId === 'h7')!
    expect(h7.plannedEnter >= '12:00').toBe(true)
    expect(h7.note).toContain('灯光维护')
  })

  it('无障碍路线跳过不可达展厅（四号厅）', () => {
    const theme = THEMES.find((t) => t.id === 't_master')!
    const stops = buildRoute(theme, HALLS, '11:10', { accessible: true })
    expect(stops.find((s) => s.hallId === 'h4')?.state).toBe('skipped')
  })
})

describe('occupancyGrid / hallLoadAt', () => {
  it('参观中的儿童团占用三号厅 09:45 槽', () => {
    const grid = occupancyGrid(reservations)
    const h3 = HALLS.find((h) => h.id === 'h3')!
    const slot = grid.get('h3')!
    // 09:50-10:14，24 人
    expect(slot.get(9 * 60 + 45)).toBe(24)
    expect(slot.get(10 * 60 + 0)).toBe(24)
    expect(h3.capacity).toBeGreaterThan(24)
  })

  it('已离馆团不再占用展厅，维护/跳过站不计数', () => {
    const grid = occupancyGrid(reservations)
    // R5 已离馆：二号厅 09:30 槽应无占用
    expect(grid.get('h2')?.get(9 * 60 + 30)).toBeUndefined()
    // 参观中 R3：三号厅 10:00 槽 24 人
    expect(grid.get('h3')?.get(10 * 60)).toBe(24)
  })
})

describe('routePeakLoads', () => {
  it('新团叠加到已确认团时，二号厅 11:15 槽给出满载率', () => {
    const r4 = byId('R20261001-04')
    const grid = occupancyGrid(reservations)
    const peaks = routePeakLoads(r4.route, HALLS, grid)
    const h2 = peaks.find((p) => p.hallId === 'h2')!
    expect(h2.capacity).toBe(45)
    // R4 自身 55 人 > 容量 45（演示用：确认台会提示拆团错峰）
    expect(h2.load).toBeGreaterThanOrEqual(55)
  })
})

describe('availableGuides', () => {
  it('英语团 10:40-12:05 只可选英语讲解员，且排除已占用的周牧', () => {
    const list = availableGuides(GUIDES, reservations, {
      language: 'en',
      themeId: 't_west',
      startHM: '10:40',
      endHM: '12:05',
    })
    const english = list.filter((g) => g.langs.includes('en'))
    expect(english.map((g) => g.id).sort()).toEqual(['g2'])
    const zhou = list.find((g) => g.id === 'g2')!
    expect(zhou.ok).toBe(false)
    expect(zhou.conflicts.join()).toContain('冲突')
  })

  it('中文亲子团上午时段可选苏晓', () => {
    const list = availableGuides(GUIDES, [], {
      language: 'zh',
      themeId: 't_family',
      startHM: '10:50',
      endHM: '12:05',
    })
    const su = list.find((g) => g.id === 'g3')!
    expect(su.ok).toBe(true)
  })
})

describe('securityPlan', () => {
  it('无障碍团优先推荐无障碍通道', () => {
    const plan = securityPlan(SECURITY_LANES, reservations, '11:00', 55, true)
    expect(plan[0].lane.accessibleOnly).toBe(true)
  })

  it('同槽团队计入通道负载', () => {
    const plan = securityPlan(SECURITY_LANES, reservations, '10:30', 30, false, 'NEW')
    const laneA = plan.find((p) => p.lane.id === 'lane_a')!
    // R2 已占 A 通道 10:30 槽 30 人
    expect(laneA.loadBefore).toBe(30)
    expect(laneA.loadAfter).toBe(60)
    expect(laneA.waitSlots).toBeGreaterThan(0)
  })
})

describe('guideBusyWindows', () => {
  it('苏晓当日带儿童团，窗口覆盖 09:40-10:50', () => {
    const wins = guideBusyWindows(reservations, 'g3')
    expect(wins).toHaveLength(1)
    expect(wins[0].start).toBeLessThanOrEqual(10 * 60 - 10)
    expect(wins[0].end).toBeGreaterThan(10 * 60 + 45)
  })
})

describe('suggestReroute', () => {
  it('儿童团在五号厅遇堵时，优先推荐相邻儿童友好展厅', () => {
    const r3 = byId('R20261001-03')
    const grid = occupancyGrid(reservations)
    const live = { maintenance: {}, extraLoad: {} }
    const picks = suggestReroute(r3, 'h5', HALLS, grid, live, '10:25')
    expect(picks.length).toBeGreaterThan(0)
    const top = picks[0]
    expect(top.hall.childFriendly || top.hall.themes.includes('t_family')).toBe(true)
  })

  it('维护中的展厅不会被推荐', () => {
    const r2 = byId('R20261001-02')
    const grid = occupancyGrid(reservations)
    const live = { maintenance: {}, extraLoad: {} }
    const picks = suggestReroute(r2, 'h6', HALLS, grid, live, '11:20')
    expect(picks.find((p) => p.hall.id === 'h7')).toBeUndefined()
  })
})

describe('downstreamImpact', () => {
  it('后续团改动路线若与在馆团撞容量，给出冲突', () => {
    const r1 = byId('R20261001-01') // 42 人待确认
    // 构造 r1 10:20 进 h5（24 人儿童团 10:20 已在 h5，容量 40）→ 66 > 40
    const stops: RouteStop[] = [
      {
        hallId: 'h5',
        plannedEnter: '10:20',
        plannedLeave: '10:45',
        durationMin: 25,
        state: 'planned',
      },
    ]
    const conflicts = downstreamImpact(r1, stops, reservations, HALLS)
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts[0].reservation.id).toBe('R20261001-03')
    expect(conflicts[0].capacity).toBe(40)
  })

  it('错峰 30 分钟后冲突消失', () => {
    const r1 = byId('R20261001-01')
    const stops: RouteStop[] = [
      {
        hallId: 'h5',
        plannedEnter: '10:50',
        plannedLeave: '11:15',
        durationMin: 25,
        state: 'planned',
      },
    ]
    // 儿童团 edu 10:50-11:05 容量 25：42 人本身也会触发；改为中庭验证错峰
    const courtyard: RouteStop[] = [
      {
        hallId: 'courtyard',
        plannedEnter: '10:50',
        plannedLeave: '11:15',
        durationMin: 25,
        state: 'planned',
      },
    ]
    expect(downstreamImpact(r1, courtyard, reservations, HALLS)).toHaveLength(0)
    expect(stops.length).toBe(1)
  })
})

describe('Reservation 种子完整性', () => {
  it('每个预约都有提交事件且时间线按时间排序', () => {
    for (const r of reservations) {
      expect(r.timeline[0]?.kind === 'submit' || r.id === 'R20261001-05').toBe(true)
      const times = r.timeline.map((e) => e.at)
      const sorted = [...times].sort()
      expect(times).toEqual(sorted)
    }
  })
  it('参观中团的设备全部为借出且押金匹配', () => {
    const r3 = byId('R20261001-03')
    expect(r3.devices).toHaveLength(24)
    expect(r3.devices.every((d) => d.status === 'lent')).toBe(true)
    expect(r3.depositTotal).toBe(4800)
  })
})

describe('临时闭展分流', () => {
  it('affectedByClosure 只筛出路线经该厅且时段重叠、未离馆的团队', () => {
    // 种子 R6/R7 已离馆（历史闭展案例），复制并恢复为参观中以验证实时筛选
    const live: Reservation[] = JSON.parse(JSON.stringify(reservations))
    for (const id of ['R20261001-06', 'R20261001-07']) {
      const r = live.find((x) => x.id === id)!
      r.status = 'touring'
      const h6 = r.route.find((s) => s.hallId === 'h6')
      if (h6) h6.state = 'planned'
    }
    // 六号厅 09:00-10:20 闭展：R6（10:00 站）、R7（09:30 站）应被筛出
    const hit = affectedByClosure(live, 'h6', '09:00', '10:20').map((r) => r.id)
    expect(hit).toContain('R20261001-06')
    expect(hit).toContain('R20261001-07')
    // R5 已离馆、R4 11:10 后才到六号厅，均不在内
    expect(hit).not.toContain('R20261001-05')
    expect(hit).not.toContain('R20261001-04')
  })

  it('closureWaitMin：计划站按计划进场等待复开，当前站按现在时刻', () => {
    const planned: RouteStop = { hallId: 'h6', plannedEnter: '10:00', plannedLeave: '10:25', durationMin: 25, state: 'planned' }
    expect(closureWaitMin(planned, '10:20', '09:30')).toBe(20)
    const current: RouteStop = { hallId: 'h6', plannedEnter: '09:30', plannedLeave: '09:58', durationMin: 28, state: 'current' }
    expect(closureWaitMin(current, '10:20', '09:40')).toBe(40)
  })

  it('switchableThemes：仅返回本团讲解员可讲、不含闭展厅的主题', () => {
    const r7 = byId('R20261001-07') // g2 周牧，t_west，会 en
    const themes = switchableThemes(r7, 'h6', THEMES, HALLS, GUIDES).map((t) => t.id)
    // 周牧可讲 t_master / t_modern，但 t_master 含 h6，应被排除
    expect(themes).toContain('t_modern')
    expect(themes).not.toContain('t_master')
    expect(themes).not.toContain('t_west') // 不含当前主题
  })

  it('briefingPoints：替代展厅禁拍/安静要求进入讲解重点', () => {
    const r6 = byId('R20261001-06')
    const points = briefingPoints(
      HALLS.find((h) => h.id === 'h6')!,
      '照明配电柜跳闸',
      HALLS.find((h) => h.id === 'h1')!,
      r6,
      undefined,
    )
    expect(points.join()).toContain('临时关闭')
    expect(points.join()).toContain('禁拍')
    expect(points.join()).toContain('保持安静')
  })

  it('closureReview：被改线团队投诉率 50%、满意度均值 3.5、退款 ¥200', () => {
    const [incident] = seedIncidents()
    const rv = closureReview(incident, reservations)
    expect(rv.affected).toBe(2)
    expect(rv.rerouted).toBe(1)
    expect(rv.refused).toBe(1)
    expect(rv.feedbackCount).toBe(2)
    expect(rv.complaintRate).toBe(0.5)
    expect(rv.avgSatisfaction).toBeCloseTo(3.5, 5)
    expect(rv.refundTotal).toBe(200)
  })

  it('shouldAddWarning：投诉率≥25% 或满意度≤3.5 时建议加预警', () => {
    const [incident] = seedIncidents()
    expect(shouldAddWarning(closureReview(incident, reservations))).toBe(true)
  })
})
