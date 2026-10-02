import { defineStore } from 'pinia'
import { DAMAGE_FEE, LOST_FEE } from '@/data/museum'
import { seedReservations } from '@/data/seed'
import {
  buildRoute,
  plannedDuration,
} from '@/lib/schedule'
import { addHM, hmOfISO, toMin, uid } from '@/lib/time'
import { useMuseumStore } from './museum'
import type {
  AgeBand,
  EventKind,
  GroupType,
  HallClosure,
  Language,
  Reservation,
  ReservationStatus,
  RouteStop,
  TimelineEvent,
} from '@/types'

export interface NewReservationInput {
  orgType: GroupType
  orgName: string
  groupSize: number
  ageBand: AgeBand
  language: Language
  accessible: boolean
  themeId: string
  arriveTime: string // ISO
  contactName: string
  contactPhone: string
  busInfo: string
  needHeadsets: boolean
  headsetCount: number
  note: string
}

export const useReservationsStore = defineStore('reservations', {
  state: () => ({
    list: seedReservations() as Reservation[],
  }),

  getters: {
    byId: (s) => (id: string) => s.list.find((r) => r.id === id),
    byStatus: (s) => (status: ReservationStatus) =>
      [...s.list]
        .filter((r) => r.status === status)
        .sort((a, b) => a.arriveTime.localeCompare(b.arriveTime)),
    /** 当日讲解总时长（分钟），已确认+在馆团 */
    activeList: (s) =>
      s.list.filter((r) => ['confirmed', 'arrived', 'touring'].includes(r.status)),
  },

  actions: {
    // ---------- 基础工具 ----------
    log(r: Reservation, kind: EventKind, title: string, atISO: string, by: string, extra: Partial<TimelineEvent> = {}) {
      const e: TimelineEvent = { id: uid('ev'), at: atISO, kind, title, by, ...extra }
      r.timeline.push(e)
      r.timeline.sort((a, b) => a.at.localeCompare(b.at))
    },
    refreshDuration(r: Reservation) {
      r.durationMin = plannedDuration(r.route)
    },

    // ---------- 预约方 ----------
    create(input: NewReservationInput): Reservation {
      const museum = useMuseumStore()
      const theme = museum.themeById(input.themeId)!
      const enterHM = addHM(hmOfISO(input.arriveTime), 10) // 安检+集结 10 分钟
      const route = buildRoute(theme, museum.halls, enterHM, {
        accessible: input.accessible,
        live: museum.maintenance,
      })
      const seq = String(this.list.length + 1).padStart(2, '0')
      const r: Reservation = {
        id: `R20261001-${seq}`,
        ...input,
        status: 'submitted',
        createdAt: museum.nowISO,
        assignedGuideIds: [],
        route,
        durationMin: plannedDuration(route),
        devices: [],
        depositTotal: 0,
        depositDeduction: 0,
        timeline: [],
      }
      // 避免 id 冲突
      while (this.list.some((x) => x.id === r.id)) {
        r.id = `${r.id}X`
      }
      this.log(r, 'submit', '团体预约已提交', input.arriveTime, input.contactName, {
        detail: `${input.groupSize} 人 · ${theme.name}`,
      })
      this.list.unshift(r)
      return r
    },

    cancel(id: string, by: string) {
      const r = this.byId(id)
      if (!r || ['completed', 'cancelled'].includes(r.status)) return
      r.status = 'cancelled'
      this.log(r, 'cancel', '预约已取消', useMuseumStore().nowISO, by)
    },

    addComplaint(id: string, text: string, by: string) {
      const r = this.byId(id)
      if (!r) return
      r.complaint = text
      this.log(r, 'complaint', '投诉登记：' + text, useMuseumStore().nowISO, by)
    },
    replyComplaint(id: string, reply: string, by: string) {
      const r = this.byId(id)
      if (!r) return
      r.complaintReply = reply
      this.log(r, 'complaint', '馆方已答复投诉', useMuseumStore().nowISO, by, { detail: reply })
    },

    // ---------- 馆方确认 ----------
    confirm(
      id: string,
      payload: { guideIds: string[]; laneId: string; batchNo: string; note: string },
      by: string,
    ) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r || r.status !== 'submitted') return
      r.status = 'confirmed'
      r.confirmedAt = museum.nowISO
      r.assignedGuideIds = payload.guideIds
      r.securityLane = payload.laneId
      r.batchNo = payload.batchNo
      r.confirmNote = payload.note
      const names = payload.guideIds.map((g) => museum.guideById(g)?.name).join('、')
      this.log(r, 'confirm', `预约确认：${names} / ${payload.batchNo} 批次`, museum.nowISO, by, {
        detail: payload.note,
      })
    },

    reject(id: string, reason: string, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r || r.status !== 'submitted') return
      r.status = 'rejected'
      this.log(r, 'reject', '预约驳回：' + reason, museum.nowISO, by)
    },

    // ---------- 前台到馆 ----------
    markArrived(id: string, atISO?: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r || r.status !== 'confirmed') return
      r.status = 'arrived'
      r.actualArrive = atISO ?? museum.nowISO
      const plan = hmOfISO(r.arriveTime)
      const actual = hmOfISO(r.actualArrive)
      const delta = toMin(actual) - toMin(plan)
      this.log(r, 'arrive', `团队到馆（${delta === 0 ? '准时' : delta > 0 ? `迟到 ${delta} 分钟` : `早到 ${-delta} 分钟`}）`, r.actualArrive, r.contactName)
    },

    verifyHeadcount(id: string, n: number, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      r.verifiedSize = n
      const diff = n - r.groupSize
      this.log(
        r,
        'headcount',
        `前台核验人数：${n} 人${diff === 0 ? '，与预约一致' : diff > 0 ? `，比预约多 ${diff} 人` : `，比预约少 ${-diff} 人`}`,
        museum.nowISO,
        by,
      )
    },

    handoutHeadsets(id: string, count: number, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r || !r.needHeadsets) return
      const at = museum.nowISO
      const picked = museum.lendFromPool(count, r.id, at)
      r.devices = picked
      r.depositTotal = picked.length * museum.depositPerUnit
      const codes = picked.length ? `${picked[0].code} ~ ${picked[picked.length - 1].code}` : ''
      this.log(r, 'device_handout', `发放耳麦 ${picked.length} 台（${codes}）`, at, by, {
        amount: r.depositTotal,
        detail: `押金 ¥${r.depositTotal.toLocaleString()} 已收取${picked.length < count ? '，库存不足部分未发' : ''}`,
      })
    },

    admit(id: string, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r || r.status !== 'arrived') return
      const now = museum.nowHM
      r.status = 'touring'
      const first = r.route.find((s) => s.state === 'planned')
      if (first) {
        first.state = 'current'
        first.actualEnter = now
      }
      this.log(r, 'batch_admit', `${r.batchNo ?? ''} 批次安检入馆`, museum.nowISO, by)
      this.log(r, 'start_tour', `${museum.themeById(r.themeId)?.name ?? ''}开始讲解`, museum.nowISO, museum.guideById(r.assignedGuideIds[0])?.name ?? by)
    },

    // ---------- 途中调度 ----------
    /** 当前站打卡完成，进入下一站 */
    advanceStop(id: string, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      const idx = r.route.findIndex((s) => s.state === 'current')
      if (idx < 0) return
      const cur = r.route[idx]
      cur.state = 'done'
      cur.actualLeave = museum.nowHM
      const next = r.route.slice(idx + 1).find((s) => s.state === 'planned')
      if (next) {
        next.state = 'current'
        next.actualEnter = addHM(museum.nowHM, 5)
      }
      this.log(r, 'wait', `完成「${museum.hallById(cur.hallId)?.name}」参观，转入下一展厅`, museum.nowISO, by)
    },

    /** 团体迟到 / 儿童走散暂停：整体顺延后续计划 */
    delay(id: string, minutes: number, kind: EventKind, title: string, detail: string, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      for (const s of r.route) {
        if (s.actualEnter || s.state === 'skipped' || s.state === 'maintenance') continue
        s.plannedEnter = addHM(s.plannedEnter, minutes)
        s.plannedLeave = addHM(s.plannedLeave, minutes)
      }
      this.refreshDuration(r)
      this.log(r, kind, title, museum.nowISO, by, { detail: `后续展厅整体顺延 ${minutes} 分钟。${detail}` })
    },

    childLost(id: string, childName: string, pauseMin: number, resolved: boolean, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      this.log(r, 'child_lost', `${resolved ? '儿童走散已找回' : '报告儿童走散'}：${childName}`, museum.nowISO, by, {
        detail: resolved ? `暂停参观 ${pauseMin} 分钟后继续，已通知广播与安保。` : '已通知广播与安保，暂停前进。',
      })
      if (resolved && pauseMin > 0) {
        this.delay(id, pauseMin, 'wait', `等待走散儿童归队（${pauseMin} 分钟）`, '', by)
      }
    },

    /** 展厅拥堵登记（只记录，改道在 applyReroute 中执行） */
    markCongestion(id: string, hallId: string, note: string, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      const stop = r.route.find((s) => s.hallId === hallId && ['current', 'planned'].includes(s.state))
      if (stop) {
        stop.state = 'congested'
        stop.note = note
      }
      this.log(r, 'hall_congestion', `「${museum.hallById(hallId)?.name}」拥堵，启动分流`, museum.nowISO, by, {
        detail: note,
      })
    },

    /** 展厅临时维护：写入全局状态，并把所有在馆/待入场团受影响的站点标记维护 */
    declareMaintenance(hallId: string, closure: HallClosure, by: string) {
      const museum = useMuseumStore()
      museum.setMaintenance(hallId, closure)
      for (const r of this.list) {
        if (!['confirmed', 'arrived', 'touring'].includes(r.status)) continue
        for (const s of r.route) {
          if (s.hallId !== hallId || s.state === 'done' || s.state === 'skipped') continue
          const win = s.actualEnter ?? s.plannedEnter
          if (win < closure.end && s.plannedLeave > closure.start) {
            s.state = 'maintenance'
            s.note = `${closure.reason}（${closure.start}-${closure.end}），临时维护改道`
            this.log(r, 'maintenance', `「${museum.hallById(hallId)?.name}」临时维护（${closure.start}-${closure.end}）`, museum.nowISO, by, {
              detail: closure.reason,
            })
          }
        }
      }
    },

    /**
     * 改道：在被阻站点位置插入替代展厅，并顺延后续
     */
    applyReroute(
      id: string,
      payload: { blockedHallId: string; targetHallId: string; atHM: string; durationMin: number; reason: string },
      by: string,
    ) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      const idx = r.route.findIndex(
        (s) => s.hallId === payload.blockedHallId && s.state !== 'done' && s.state !== 'skipped',
      )
      const blocked = idx >= 0 ? r.route[idx] : undefined
      if (blocked) {
        if (blocked.state === 'current') blocked.actualLeave = payload.atHM
        blocked.state = blocked.state === 'maintenance' ? 'maintenance' : 'congested'
        blocked.note = `${blocked.note ?? ''} 改道原因：${payload.reason}`.trim()
      }
      const target = museum.hallById(payload.targetHallId)!
      const fresh: RouteStop = {
        hallId: payload.targetHallId,
        plannedEnter: payload.atHM,
        plannedLeave: addHM(payload.atHM, payload.durationMin),
        durationMin: payload.durationMin,
        state: 'current',
        actualEnter: payload.atHM,
        note: `由${museum.hallById(payload.blockedHallId)?.name ?? ''}改道至此：${payload.reason}`,
      }
      const insertAt = idx >= 0 ? idx : r.route.length
      r.route.splice(insertAt, 0, fresh)
      // 后续计划站顺延
      let cursor = fresh.plannedLeave
      for (let i = insertAt + 1; i < r.route.length; i++) {
        const s = r.route[i]
        if (s.actualEnter || s.state === 'skipped' || s.state === 'maintenance') continue
        s.state = 'planned'
        s.plannedEnter = addHM(cursor, 5)
        s.plannedLeave = addHM(s.plannedEnter, s.durationMin)
        cursor = s.plannedLeave
      }
      this.refreshDuration(r)
      this.log(
        r,
        'reroute',
        `路线调整：${museum.hallById(payload.blockedHallId)?.name ?? '原站'} → ${target.name}`,
        museum.nowISO,
        by,
        { detail: `${payload.reason}；后续团队入场时间已联动顺延。` },
      )
    },

    // ---------- 展厅临时闭展分流 ----------
    /** 批量/单个通知：闭展分流通知写入预约时间线 */
    notifyClosure(id: string, message: string, by: string) {
      const r = this.byId(id)
      if (!r) return
      this.log(r, 'closure_notice', '闭展分流通知已发送联系人', useMuseumStore().nowISO, by, {
        detail: message,
      })
    },

    /** 把某团经过闭展厅的未完成的站点标记为临时维护（投诉登记等终态处理用） */
    markClosedStop(id: string, hallId: string, note: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      for (const s of r.route) {
        if (s.hallId !== hallId || s.state === 'done' || s.state === 'skipped') continue
        if (s.state === 'current') s.actualLeave = museum.nowHM
        s.state = 'maintenance'
        s.note = note
      }
      this.refreshDuration(r)
    },

    /**
     * 闭展分流 · 接受替代路线：在受阻站点位置插入替代展厅。
     * 与途中改道不同：未到馆团队的替代站保持 planned，按原计划时刻进场。
     */
    divertFromClosedHall(
      id: string,
      payload: { closedHallId: string; targetHallId: string; atHM: string; durationMin: number; reason: string },
      by: string,
    ) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      const idx = r.route.findIndex(
        (s) => s.hallId === payload.closedHallId && s.state !== 'done' && s.state !== 'skipped',
      )
      const blocked = idx >= 0 ? r.route[idx] : undefined
      const inHall = blocked?.state === 'current'
      if (blocked) {
        if (inHall) blocked.actualLeave = payload.atHM
        blocked.state = 'maintenance'
        blocked.note = `${blocked.note ?? ''} 闭展改道：${payload.reason}`.trim()
      }
      const enterHM = inHall
        ? payload.atHM
        : blocked && blocked.plannedEnter > payload.atHM
          ? blocked.plannedEnter
          : payload.atHM
      const target = museum.hallById(payload.targetHallId)!
      const fresh: RouteStop = {
        hallId: payload.targetHallId,
        plannedEnter: enterHM,
        plannedLeave: addHM(enterHM, payload.durationMin),
        durationMin: payload.durationMin,
        state: inHall ? 'current' : 'planned',
        actualEnter: inHall ? payload.atHM : undefined,
        note: `闭展替代展厅：${payload.reason}`,
      }
      const insertAt = idx >= 0 ? idx : r.route.length
      r.route.splice(insertAt, 0, fresh)
      // 后续计划站顺延
      let cursor = fresh.plannedLeave
      for (let i = insertAt + 1; i < r.route.length; i++) {
        const s = r.route[i]
        if (s.actualEnter || s.state === 'skipped' || s.state === 'maintenance') continue
        s.state = 'planned'
        s.plannedEnter = addHM(cursor, 5)
        s.plannedLeave = addHM(s.plannedEnter, s.durationMin)
        cursor = s.plannedLeave
      }
      this.refreshDuration(r)
      this.log(
        r,
        'diversion',
        `闭展分流：${museum.hallById(payload.closedHallId)?.name ?? '原站'} → ${target.name}`,
        museum.nowISO,
        by,
        { detail: `${payload.reason}；团队接受替代路线，后续站点已联动顺延。` },
      )
    },

    /** 闭展分流 · 等待恢复开放：受影响站点顺延到恢复时刻，后续站联动 */
    waitForReopen(id: string, hallId: string, reopenHM: string, waitMin: number, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      const idx = r.route.findIndex(
        (s) => s.hallId === hallId && s.state !== 'done' && s.state !== 'skipped',
      )
      if (idx < 0) return
      const stop = r.route[idx]
      if (stop.state === 'current') {
        // 在厅团队先离厅等候，恢复后重新进场
        stop.actualLeave = museum.nowHM
        stop.actualEnter = undefined
        stop.state = 'planned'
      }
      stop.plannedEnter = addHM(reopenHM, 5)
      stop.plannedLeave = addHM(stop.plannedEnter, stop.durationMin)
      stop.note = `展厅临时闭展，团队选择等待恢复（预计等待 ${waitMin} 分钟），已顺延至 ${stop.plannedEnter}`
      let cursor = stop.plannedLeave
      for (let i = idx + 1; i < r.route.length; i++) {
        const s = r.route[i]
        if (s.actualEnter || s.state === 'skipped' || s.state === 'maintenance') continue
        s.plannedEnter = addHM(cursor, 5)
        s.plannedLeave = addHM(s.plannedEnter, s.durationMin)
        cursor = s.plannedLeave
      }
      this.refreshDuration(r)
      this.log(
        r,
        'diversion',
        `闭展分流：等待「${museum.hallById(hallId)?.name}」恢复开放（约 ${waitMin} 分钟）`,
        museum.nowISO,
        by,
        { detail: `受影响站点顺延至 ${stop.plannedEnter} 进场，后续站点已联动顺延。` },
      )
    },

    /** 闭展分流 · 更换讲解主题：保留已完成/进行中站点，未完成站点按新主题重排 */
    switchTheme(id: string, newThemeId: string, reason: string, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      const theme = museum.themeById(newThemeId)
      if (!theme) return
      const oldTheme = museum.themeById(r.themeId)
      const current = r.route.find((s) => s.state === 'current')
      const visited = new Set(
        r.route
          .filter((s) => s.state === 'done' || s.state === 'current' || s.state === 'maintenance')
          .map((s) => s.hallId),
      )
      const startHM = current
        ? addHM(current.plannedLeave > museum.nowHM ? current.plannedLeave : museum.nowHM, 5)
        : (r.route.find((s) => s.state === 'planned')?.plannedEnter ?? addHM(museum.nowHM, 10))
      const built = buildRoute(theme, museum.halls, startHM, {
        accessible: r.accessible,
        live: museum.maintenance,
      }).filter((s) => !visited.has(s.hallId))
      // 保留已完成/进行中/闭展终止的站点作为历史，未完成站点按新主题重排
      const kept = r.route.filter(
        (s) => s.state === 'done' || s.state === 'current' || s.state === 'maintenance',
      )
      const dropped = r.route.length - kept.length
      r.route = [...kept, ...built]
      r.themeId = newThemeId
      this.refreshDuration(r)
      this.log(
        r,
        'theme_switch',
        `讲解主题变更：${oldTheme?.name ?? '—'} → ${theme.name}`,
        museum.nowISO,
        by,
        { detail: `${reason}；未完成站点已按新主题重排（原 ${dropped} 个站点替换为 ${built.length} 个）。` },
      )
    },

    /** 闭展分流 · 拒绝替代路线 → 部分退款：闭展站点终止参观，累计退款金额 */
    applyRefund(id: string, hallId: string, amount: number, reason: string, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r || amount <= 0) return
      this.markClosedStop(id, hallId, `闭展放弃参观，已办理部分退款 ¥${amount}。${reason}`)
      r.refundTotal = (r.refundTotal ?? 0) + amount
      this.log(r, 'refund', `部分退款 ¥${amount.toLocaleString()}`, museum.nowISO, by, {
        amount,
        detail: reason,
      })
    },

    /** 闭展分流 · 拒绝替代路线 → 改期：原预约取消，按原信息生成新日期预约 */
    reschedule(id: string, newArriveISO: string, by: string): Reservation | null {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r || ['completed', 'cancelled'].includes(r.status)) return null
      this.log(
        r,
        'reschedule',
        `团队改期至 ${newArriveISO.slice(0, 10)} ${hmOfISO(newArriveISO)}`,
        museum.nowISO,
        by,
        { detail: '展厅临时闭展，团队拒绝替代路线，办理改期；原预约终止。' },
      )
      r.status = 'cancelled'
      const theme = museum.themeById(r.themeId)
      const route = theme
        ? buildRoute(theme, museum.halls, addHM(hmOfISO(newArriveISO), 10), {
            accessible: r.accessible,
          })
        : []
      const seq = String(this.list.length + 1).padStart(2, '0')
      const nr: Reservation = {
        ...r,
        id: `R20261001-${seq}`,
        arriveTime: newArriveISO,
        status: 'submitted',
        createdAt: museum.nowISO,
        confirmedAt: undefined,
        confirmNote: undefined,
        assignedGuideIds: [],
        batchNo: undefined,
        securityLane: undefined,
        actualArrive: undefined,
        verifiedSize: undefined,
        route,
        durationMin: plannedDuration(route),
        devices: [],
        depositTotal: 0,
        depositDeduction: 0,
        departAt: undefined,
        satisfaction: undefined,
        complaint: undefined,
        complaintReply: undefined,
        refundTotal: undefined,
        rescheduleOf: r.id,
        timeline: [],
      }
      while (this.list.some((x) => x.id === nr.id)) nr.id = `${nr.id}X`
      this.log(nr, 'submit', `改期预约已生成（原 ${r.id}）`, museum.nowISO, by, {
        detail: `${r.orgName} ${r.groupSize} 人，改期至 ${newArriveISO.slice(0, 10)} ${hmOfISO(newArriveISO)} 到馆，待馆方确认。`,
      })
      this.list.unshift(nr)
      return nr
    },

    /** 讲解员临时替换 */
    swapGuide(id: string, oldGuideId: string, newGuideId: string, reason: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      const pos = r.assignedGuideIds.indexOf(oldGuideId)
      if (pos >= 0) r.assignedGuideIds.splice(pos, 1, newGuideId)
      else r.assignedGuideIds.push(newGuideId)
      const oldN = museum.guideById(oldGuideId)?.name ?? oldGuideId
      const newN = museum.guideById(newGuideId)?.name ?? newGuideId
      this.log(r, 'guide_swap', `讲解员变更：${oldN} → ${newN}`, museum.nowISO, newN, {
        detail: reason,
      })
    },

    /** 途中耳麦损坏：旧机登记损坏、补发新机 */
    exchangeHeadset(id: string, oldCode: string, note: string, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      const newCode = museum.exchangeFromPool(oldCode, r.id, museum.nowISO, note)
      const oldDev = r.devices.find((d) => d.code === oldCode)
      if (oldDev) {
        oldDev.status = 'damaged'
        oldDev.damageFee = DAMAGE_FEE
        oldDev.note = note
      }
      if (newCode) {
        r.devices.push({
          code: newCode,
          status: 'lent',
          deposit: museum.depositPerUnit,
          resId: r.id,
          lentAt: museum.nowISO,
        })
      }
      this.log(r, 'device_exchange', `耳麦 ${oldCode} 损坏${newCode ? `，补发 ${newCode}` : '（库存不足，未补发）'}`, museum.nowISO, by, {
        detail: `${note}；赔偿待离馆押金结算。`,
      })
    },

    // ---------- 离馆 ----------
    returnDevices(
      id: string,
      results: { code: string; result: 'ok' | 'damaged' | 'lost'; note?: string }[],
      by: string,
    ) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      let okN = 0
      let dmgN = 0
      let lostN = 0
      for (const item of results) {
        const dev = r.devices.find((d) => d.code === item.code)
        if (!dev) continue
        if (item.result === 'ok') {
          dev.status = 'returned'
          dev.returnedAt = museum.nowISO
          museum.syncPoolDevice(item.code, 'returned', { returnedAt: museum.nowISO })
          okN++
        } else if (item.result === 'damaged') {
          dev.status = 'damaged'
          dev.damageFee = DAMAGE_FEE
          dev.note = item.note ?? '设备损坏'
          dev.returnedAt = museum.nowISO
          museum.syncPoolDevice(item.code, 'damaged', {
            returnedAt: museum.nowISO,
            damageFee: DAMAGE_FEE,
            note: item.note,
          })
          dmgN++
        } else {
          dev.status = 'lost'
          dev.damageFee = LOST_FEE
          dev.note = item.note ?? '设备遗失'
          museum.syncPoolDevice(item.code, 'lost', { damageFee: LOST_FEE, note: item.note })
          lostN++
        }
      }
      // 扣款统计包含途中换机已登记损坏/遗失的设备
      r.depositDeduction = r.devices.reduce(
        (sum, d) => sum + (d.status === 'damaged' ? DAMAGE_FEE : d.status === 'lost' ? LOST_FEE : 0),
        0,
      )
      this.log(r, 'device_return', `归还耳麦：完好 ${okN}，损坏 ${dmgN}，遗失 ${lostN}`, museum.nowISO, by)
    },

    settleDeposit(id: string, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r) return
      this.log(
        r,
        'deposit_settle',
        `押金结算：¥${r.depositTotal.toLocaleString()} 中扣除 ¥${r.depositDeduction}，退还 ¥${(r.depositTotal - r.depositDeduction).toLocaleString()}`,
        museum.nowISO,
        by,
        { amount: r.depositDeduction },
      )
    },

    complete(id: string, satisfaction: number, by: string) {
      const r = this.byId(id)
      const museum = useMuseumStore()
      if (!r || r.status !== 'touring') return
      r.status = 'completed'
      r.departAt = museum.nowISO
      r.satisfaction = satisfaction
      // 未关闭的站点统一收尾
      for (const s of r.route) {
        if (s.state === 'current') {
          s.state = 'done'
          s.actualLeave = museum.nowHM
        } else if (s.state === 'planned') {
          s.state = 'skipped'
          s.note = (s.note ?? '') + ' 离馆时未参观'.trim()
        }
      }
      this.log(r, 'complete', `团队离馆，满意度 ${satisfaction}/5`, museum.nowISO, by)
    },

    resetAll() {
      const museum = useMuseumStore()
      museum.resetAll()
      this.list = seedReservations()
    },
  },

  persist: { key: 'museum-reservations' },
})
