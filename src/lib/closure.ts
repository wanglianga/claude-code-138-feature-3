/**
 * 展厅临时闭展分流 · 领域逻辑
 * 受影响团队筛选 / 预计等待 / 可换讲解主题 / 部分退款估算 / 讲解重点 / 复盘统计
 */
import type {
  ClosureIncident,
  DiversionRecord,
  Guide,
  Hall,
  HallClosure,
  Reservation,
  RouteStop,
  Theme,
} from '@/types'
import { GROUP_TICKET_PRICE, REFUND_MAX_RATIO } from '@/data/museum'
import { addHM, overlap, toMin } from './time'

/** 仍受闭展影响的预约状态（已离馆/已取消/已驳回不再处置） */
export const DIVERTABLE_STATUSES = ['submitted', 'confirmed', 'arrived', 'touring'] as const

export interface AffectedTeam {
  reservation: Reservation
  stop: RouteStop // 受闭展影响的路线站点
}

/**
 * 从当日预约中筛出受某闭展事件影响的团队：
 * 路线中存在经过该展厅、尚未完成/跳过、且时间窗与闭展时段重叠的站点。
 */
export function affectedByIncident(
  reservations: Reservation[],
  incident: ClosureIncident,
): AffectedTeam[] {
  const out: AffectedTeam[] = []
  for (const r of reservations) {
    if (!DIVERTABLE_STATUSES.includes(r.status as (typeof DIVERTABLE_STATUSES)[number])) continue
    for (const s of r.route) {
      if (s.hallId !== incident.hallId) continue
      // 已完成/已跳过/已按闭展处置（maintenance）的站点不再重复处置
      if (s.state === 'done' || s.state === 'skipped' || s.state === 'maintenance') continue
      const enter = s.actualEnter ?? s.plannedEnter
      if (enter < incident.end && s.plannedLeave > incident.start) {
        out.push({ reservation: r, stop: s })
        break // 一个团队一条处置记录
      }
    }
  }
  return out.sort((a, b) => a.reservation.arriveTime.localeCompare(b.reservation.arriveTime))
}

/**
 * 预计等待分钟：若选择等待恢复开放，
 * 从 max(当前时刻, 计划进场) 等到 闭展结束 + 5 分钟缓冲。
 */
export function waitEstimateMin(
  incident: ClosureIncident,
  stop: RouteStop,
  nowHM: string,
): number {
  const enter = stop.actualEnter ?? stop.plannedEnter
  const from = Math.max(toMin(enter), toMin(nowHM))
  return Math.max(0, toMin(incident.end) + 5 - from)
}

/** 等待恢复后的预计进场时刻 */
export function reopenEnterHM(incident: ClosureIncident): string {
  return addHM(incident.end, 5)
}

export interface SwitchableTheme {
  theme: Theme
  coverGuides: Guide[] // 能讲该主题的（本团）讲解员
  hallNames: string[]
}

/**
 * 是否可换讲解主题：
 * - 新主题剩余展厅（剔除已参观）在无障碍约束下全部可达；
 * - 未来讲解窗口内这些展厅均无闭展；
 * - 本团已派讲解员中至少一人会讲该主题（未派工时按语言匹配全馆讲解员）。
 */
export function switchableThemes(
  reservation: Reservation,
  themes: Theme[],
  halls: Hall[],
  live: Record<string, HallClosure>,
  guides: Guide[],
  nowHM: string,
): SwitchableTheme[] {
  const visited = new Set(
    reservation.route
      .filter((s) => s.state === 'done' || s.state === 'current' || s.state === 'maintenance')
      .map((s) => s.hallId),
  )
  const winStart = toMin(nowHM)
  const winEnd = winStart + 180 // 未来 3 小时讲解窗口
  const assigned = reservation.assignedGuideIds
    .map((id) => guides.find((g) => g.id === id))
    .filter((g): g is Guide => !!g)
  const pool = assigned.length
    ? assigned
    : guides.filter((g) => g.langs.includes(reservation.language))

  return themes
    .filter((t) => t.id !== reservation.themeId)
    .map((theme) => {
      const remaining = theme.hallIds.filter((hid) => !visited.has(hid))
      if (!remaining.length) return null
      const allOpen = remaining.every((hid) => {
        const hall = halls.find((h) => h.id === hid)
        if (!hall) return false
        if (reservation.accessible && !hall.accessible) return false
        const closures = hall.closures.concat(live[hid] ? [live[hid]] : [])
        return !closures.some((c) => overlap(winStart, winEnd, toMin(c.start), toMin(c.end)))
      })
      if (!allOpen) return null
      const coverGuides = pool.filter((g) => g.themes.includes(theme.id))
      if (!coverGuides.length) return null
      return {
        theme,
        coverGuides,
        hallNames: remaining.map(
          (hid) => halls.find((h) => h.id === hid)?.name.replace(/^.*? · /, '') ?? hid,
        ),
      }
    })
    .filter((x): x is SwitchableTheme => !!x)
}

export interface RefundSuggestion {
  missedMin: number // 因闭展损失的讲解时长
  ratio: number // 占计划总时长比例（封顶 REFUND_MAX_RATIO）
  amount: number // 建议退款金额（元）
  size: number
  unitPrice: number
}

/**
 * 部分退款估算：团体票单价 × 人数 × 未参观时长占比（封顶 50%）。
 */
export function suggestRefund(
  reservation: Reservation,
  hallId: string,
  unitPrice = GROUP_TICKET_PRICE,
): RefundSuggestion {
  const missedMin = reservation.route
    .filter((s) => s.hallId === hallId && s.state !== 'done' && s.state !== 'skipped')
    .reduce((sum, s) => sum + s.durationMin, 0)
  const total = Math.max(reservation.durationMin, 1)
  const ratio = Math.min(REFUND_MAX_RATIO, missedMin / total)
  const size = reservation.verifiedSize ?? reservation.groupSize
  return { missedMin, ratio, amount: Math.round(unitPrice * size * ratio), size, unitPrice }
}

/**
 * 讲解重点：按展厅展品与团队特征生成讲解员提示，
 * 闭展改线/换主题后在讲解员端同步。
 */
export function talkingPoints(hall: Hall, reservation: Reservation): string[] {
  const pts: string[] = []
  const hot = hall.exhibits.filter((e) => e.hot)
  if (hot.length) pts.push(`重点讲解：${hot.map((e) => e.name).join('、')}`)
  const noPhoto = hall.exhibits.filter((e) => e.noPhoto)
  if (noPhoto.length) pts.push(`提醒禁拍：${noPhoto.map((e) => e.name).join('、')}`)
  const ages = hall.exhibits
    .map((e) => e.recommendedAge)
    .filter((x): x is number => typeof x === 'number')
  if (ages.length) pts.push(`展品建议年龄 ≥ ${Math.min(...ages)} 岁`)
  if (hall.quiet === 3) pts.push('展厅需保持安静，控制讲解音量')
  const kids = reservation.ageBand === 'children' || reservation.ageBand === 'mixed'
  if (kids && hall.childFriendly) pts.push('儿童友好展厅，可安排互动停留')
  if (reservation.accessible) {
    pts.push(hall.accessible ? '无障碍可达，注意轮椅动线' : '⚠ 该厅无无障碍通道，需现场协助')
  }
  return pts
}

export interface IncidentStats {
  affected: number // 受影响团队数
  decided: number // 已处置数
  rerouted: number // 被改线团队数（改道/换主题/等待/退款缩短行程）
  complaints: number // 被改线团队中的投诉数
  complaintRate: number // 投诉率 0-1
  avgSatisfaction: number | null // 被改线团队满意度均值
  refundSum: number // 退款合计（元）
}

/** 被改线的决策类型（投诉登记/纯通知不算改线） */
const REROUTED_DECISIONS = ['accept_alt', 'theme_switch', 'wait_reopen', 'refund'] as const

/** 闭展影响结束后的复盘统计：被改线团队的投诉率与满意度 */
export function incidentStats(
  records: DiversionRecord[],
  reservations: Reservation[],
): IncidentStats {
  const ofIncident = records.filter((r) => r.decision)
  const rerouted = ofIncident.filter((r) =>
    REROUTED_DECISIONS.includes(r.decision as (typeof REROUTED_DECISIONS)[number]),
  )
  const resOf = (id: string) => reservations.find((r) => r.id === id)
  const complaints = rerouted.filter((rec) => !!resOf(rec.resId)?.complaint).length
  const sats = rerouted
    .map((rec) => resOf(rec.resId)?.satisfaction)
    .filter((x): x is number => typeof x === 'number')
  return {
    affected: records.length,
    decided: ofIncident.length,
    rerouted: rerouted.length,
    complaints,
    complaintRate: rerouted.length ? complaints / rerouted.length : 0,
    avgSatisfaction: sats.length ? sats.reduce((a, b) => a + b, 0) / sats.length : null,
    refundSum: ofIncident.reduce((sum, r) => sum + (r.refundAmount ?? 0), 0),
  }
}
