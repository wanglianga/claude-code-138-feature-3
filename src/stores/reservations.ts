import { defineStore } from 'pinia'
import { DAMAGE_FEE, LOST_FEE, TOUR_FEE_PER_PERSON } from '@/data/museum'
import { seedReservations } from '@/data/seed'
import {
  affectedByClosure,
  briefingPoints,
  buildRoute,
  closureAlternative,
  occupancyGrid,
  plannedDuration,
} from '@/lib/schedule'
import { addHM, hmOfISO, toMin, uid } from '@/lib/time'
import { useMuseumStore } from './museum'
import type {
  AgeBand,
  ClosureIncident,
  ClosureNotice,
  EventKind,
  GroupType,
  HallClosure,
  Language,
  RefundRecord,
  Reservation,
  ReservationStatus,
  RouteStop,
  Theme,
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

    // ---------- 临时闭展分流（设备故障） ----------
    /**
     * 登记设备故障闭展：
     * 建立闭展事件、写入实时维护、从当日预约筛出受影响团队并生成处置单，
     * 同时把受影响站点标记为维护。
     */
    declareClosure(
      payload: { hallId: string; reason: string; start: string; expectedEnd: string },
      by: string,
    ): ClosureIncident {
      const museum = useMuseumStore()
      const closure: HallClosure = { start: payload.start, end: payload.expectedEnd, reason: payload.reason }
      museum.setMaintenance(payload.hallId, closure)
      const incident: ClosureIncident = {
        id: uid('inc'),
        hallId: payload.hallId,
        reason: payload.reason,
        start: payload.start,
        end: payload.expectedEnd,
        declaredAt: museum.nowISO,
        declaredBy: by,
        status: 'active',
        plans: {},
        notices: [],
      }
      const grid = occupancyGrid(this.list, { maintenance: museum.maintenance, extraLoad: museum.extraLoad })
      const affected = affectedByClosure(this.list, payload.hallId, payload.start, payload.expectedEnd)
      for (const r of affected) {
        const alt = closureAlternative(r, payload.hallId, {
          startHM: payload.start,
          expectEndHM: payload.expectedEnd,
          halls: museum.halls,
          themes: museum.themes,
          guides: museum.guides,
          grid,
          live: { maintenance: museum.maintenance, extraLoad: museum.extraLoad },
          nowHM: museum.nowHM,
        })
        incident.plans[r.id] = {
          incidentId: incident.id,
          blockedHallId: payload.hallId,
          suggestedHallId: alt?.suggestions[0]?.hall.id,
          waitMin: alt?.waitMin ?? 0,
          themeSwitchable: (alt?.altThemes.length ?? 0) > 0,
          altThemeIds: alt?.altThemes.map((t) => t.id) ?? [],
          status: 'identified',
        }
        // 站点标记维护并留痕
        for (const s of r.route) {
          if (s.hallId !== payload.hallId || s.state === 'done' || s.state === 'skipped') continue
          const win = s.actualEnter ?? s.plannedEnter
          if (win < payload.expectedEnd && s.plannedLeave > payload.start) {
            s.state = 'maintenance'
            s.note = `${payload.reason}临时闭展（${payload.start}-${payload.expectedEnd}），已纳入分流处置`
            if (s.actualEnter && !s.actualLeave) s.actualLeave = museum.nowHM
          }
        }
        this.log(
          r,
          'closure_incident',
          `「${museum.hallById(payload.hallId)?.name}」设备故障临时闭展，本团被筛出分流`,
          museum.nowISO,
          by,
          { detail: `预计等待 ${incident.plans[r.id].waitMin} 分钟${incident.plans[r.id].themeSwitchable ? '，可换讲解主题' : ''}。` },
        )
      }
      museum.addIncident(incident)
      return incident
    },

    /** 批量通知受影响团队联系人 */
    notifyClosureContacts(incidentId: string, resIds: string[], by: string) {
      const museum = useMuseumStore()
      const incident = museum.incidentById(incidentId)
      if (!incident) return
      for (const id of resIds) {
        const r = this.byId(id)
        const plan = incident.plans[id]
        if (!r || !plan) continue
        const notice: ClosureNotice = {
          id: uid('nt'),
          at: museum.nowISO,
          contactName: r.contactName,
          contactPhone: r.contactPhone,
          channel: 'im',
          by,
          result: 'delivered',
        }
        incident.notices.push(notice)
        plan.notified = true
        plan.notifiedAt = museum.nowISO
        if (plan.status === 'identified') plan.status = 'notified'
        this.log(r, 'closure_notify', `已通知联系人 ${r.contactName}（${r.contactPhone}）`, museum.nowISO, by, {
          detail: `闭展分流：${incident.reason}，预计等待 ${plan.waitMin} 分钟，替代路线/退款/改期待确认。`,
        })
      }
    },

    /** 团队接受替代路线（落地改道），并同步讲解重点 */
    acceptClosureAlternative(
      incidentId: string,
      resId: string,
      payload: { targetHallId: string; durationMin: number; switchThemeId?: string },
      by: string,
    ) {
      const museum = useMuseumStore()
      const incident = museum.incidentById(incidentId)
      const r = this.byId(resId)
      if (!incident || !r) return
      const plan = incident.plans[resId]
      if (!plan) return
      if (payload.switchThemeId && payload.switchThemeId !== r.themeId) {
        this.switchTheme(resId, payload.switchThemeId, by)
        plan.switchedThemeId = payload.switchThemeId
      }
      this.applyReroute(resId, {
        blockedHallId: incident.hallId,
        targetHallId: payload.targetHallId,
        atHM: museum.nowHM,
        durationMin: payload.durationMin,
        reason: `${incident.reason}闭展分流，团队接受替代路线`,
      }, by)
      plan.status = 'rerouted'
      plan.appliedHallId = payload.targetHallId
      plan.acceptedAlternative = true
      plan.decidedAt = museum.nowISO
      this.syncClosureBriefing(incidentId, resId, payload.targetHallId, payload.switchThemeId, by)
    },

    /** 更换讲解主题（仅记录联动，不改写剩余动线，讲解员按重点组织） */
    switchTheme(resId: string, themeId: string, by: string) {
      const museum = useMuseumStore()
      const r = this.byId(resId)
      if (!r) return
      const old = museum.themeById(r.themeId)?.name
      const next = museum.themeById(themeId)?.name
      r.themeId = themeId
      this.log(r, 'switch_theme', `讲解主题变更：${old} → ${next}`, museum.nowISO, by, {
        detail: '闭展分流，按讲解员可讲主题与团队意愿切换。',
      })
    },

    /** 向本团讲解员同步新的讲解重点 */
    syncClosureBriefing(incidentId: string, resId: string, targetHallId: string, switchThemeId?: string, by?: string) {
      const museum = useMuseumStore()
      const incident = museum.incidentById(incidentId)
      const r = this.byId(resId)
      if (!incident || !r) return
      const hall = museum.hallById(incident.hallId)!
      const target = museum.hallById(targetHallId)
      const altTheme: Theme | undefined = switchThemeId ? museum.themeById(switchThemeId) : undefined
      const points = briefingPoints(hall, incident.reason, target, r, altTheme)
      r.briefings ??= []
      for (const guideId of r.assignedGuideIds) {
        r.briefings.push({
          id: uid('br'),
          incidentId,
          guideId,
          at: museum.nowISO,
          points,
          targetHallName: target?.name,
        })
        this.log(
          r,
          'closure_guide',
          `讲解重点已同步至讲解员 ${museum.guideById(guideId)?.name ?? guideId}`,
          museum.nowISO,
          by ?? museum.guideById(guideId)?.name ?? '系统',
          { detail: points.join(' ') },
        )
      }
    },

    /** 讲解员端确认已读讲解重点 */
    markBriefingRead(resId: string, briefingId: string) {
      const museum = useMuseumStore()
      const r = this.byId(resId)
      if (!r?.briefings) return
      const b = r.briefings.find((x) => x.id === briefingId)
      if (!b || b.readAt) return
      b.readAt = museum.nowISO
      this.log(r, 'closure_guide_read', `讲解员 ${museum.guideById(b.guideId)?.name} 已确认讲解重点`, museum.nowISO, museum.guideById(b.guideId)?.name ?? '讲解员')
    },

    /** 团队拒绝替代路线：办理部分退款 / 改期 / 投诉登记 */
    refuseClosureAlternative(
      incidentId: string,
      resId: string,
      action: 'refund' | 'reschedule' | 'complaint',
      payload: { refundRatio?: number; rescheduleTo?: string; complaint?: string; reason?: string },
      by: string,
    ) {
      const museum = useMuseumStore()
      const incident = museum.incidentById(incidentId)
      const r = this.byId(resId)
      if (!incident || !r) return
      const plan = incident.plans[resId]
      if (!plan) return
      plan.acceptedAlternative = false
      plan.decidedAt = museum.nowISO

      if (action === 'refund') {
        const ratio = payload.refundRatio ?? 20
        const base = (r.verifiedSize ?? r.groupSize) * TOUR_FEE_PER_PERSON
        const amount = Math.round((base * ratio) / 100)
        const rec: RefundRecord = {
          id: uid('rf'),
          incidentId,
          at: museum.nowISO,
          amount,
          ratio,
          reason: payload.reason || `${incident.reason}闭展，团队拒绝替代路线`,
          by,
        }
        r.refunds ??= []
        r.refunds.push(rec)
        plan.status = 'refunded'
        this.log(r, 'partial_refund', `办理部分退款 ${ratio}%（¥${amount}）`, museum.nowISO, by, {
          amount,
          detail: `讲解服务费基数 ¥${base}（${r.verifiedSize ?? r.groupSize} 人 × ¥${TOUR_FEE_PER_PERSON}）。${rec.reason}`,
        })
      } else if (action === 'reschedule') {
        const to = payload.rescheduleTo ?? museum.nowISO
        r.rescheduledTo = to
        r.status = 'rescheduled'
        plan.status = 'rescheduled'
        this.log(r, 'reschedule', `团队拒绝替代路线，已改期至 ${to.slice(0, 16).replace('T', ' ')}`, museum.nowISO, by, {
          detail: payload.reason || '闭展改期，新预约待重新确认。',
        })
      } else {
        plan.status = 'complaint'
        const text = payload.complaint?.trim()
        if (text) {
          r.complaint = text
          this.log(r, 'complaint', '闭展投诉登记：' + text, museum.nowISO, by)
        }
      }
    },

    /** 闭展影响结束：解除维护并归档事件（投诉率/满意度在看板复盘） */
    resolveClosure(incidentId: string, endHM: string, note: string, by: string) {
      const museum = useMuseumStore()
      const incident = museum.incidentById(incidentId)
      if (!incident) return
      museum.resolveIncident(incidentId, endHM, note)
      museum.reopenHall(incident.hallId)
      for (const r of this.list) {
        if (!incident.plans[r.id]) continue
        this.log(r, 'closure_update', `「${museum.hallById(incident.hallId)?.name}」闭展影响结束（${endHM}）`, museum.nowISO, by, {
          detail: note || '设备恢复，展厅重新开放，处置单进入运营复盘。',
        })
      }
    },

    /** 运营复盘备注（随事件归档） */
    reviewClosure(incidentId: string, note: string) {
      const museum = useMuseumStore()
      museum.updateIncident(incidentId, { reviewNote: note })
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
