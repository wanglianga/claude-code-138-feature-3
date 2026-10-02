import { defineStore } from 'pinia'
import { seedClosures } from '@/data/seed'
import { affectedByIncident, waitEstimateMin } from '@/lib/closure'
import { uid } from '@/lib/time'
import { useMuseumStore } from './museum'
import { useReservationsStore } from './reservations'
import {
  CLOSURE_CATEGORY_LABEL,
  type ClosureCategory,
  type ClosureIncident,
  type DiversionRecord,
} from '@/types'

export interface DeclareIncidentInput {
  hallId: string
  start: string // HH:mm
  end: string
  reason: string
  category: ClosureCategory
}

export type DecidePayload =
  | { decision: 'accept_alt'; targetHallId: string; durationMin: number }
  | { decision: 'theme_switch'; themeId: string }
  | { decision: 'wait_reopen' }
  | { decision: 'refund'; amount: number }
  | { decision: 'reschedule'; newArriveISO: string }
  | { decision: 'complaint'; text: string }

/** 展厅临时闭展事件与受影响团队分流处置 */
export const useClosuresStore = defineStore('closures', {
  state: () => {
    const seed = seedClosures()
    return {
      incidents: seed.incidents as ClosureIncident[],
      records: seed.records as DiversionRecord[],
    }
  },

  getters: {
    active: (s) => s.incidents.filter((i) => i.status === 'active'),
    resolved: (s) => s.incidents.filter((i) => i.status === 'resolved'),
    incidentById: (s) => (id: string) => s.incidents.find((i) => i.id === id),
    recordsOf: (s) => (incidentId: string) =>
      s.records.filter((r) => r.incidentId === incidentId),
    recordFor: (s) => (incidentId: string, resId: string) =>
      s.records.find((r) => r.incidentId === incidentId && r.resId === resId),
    /** 某团队尚未被讲解员知晓的分流处置（讲解员端同步用） */
    pendingGuideAck: (s) => (resId: string) =>
      s.records.filter((r) => r.resId === resId && r.decision && !r.guideAckAt),
  },

  actions: {
    /** 登记临时闭展：写入事件并联动全局维护状态（容量/改道建议立即生效） */
    declareIncident(input: DeclareIncidentInput, by: string): ClosureIncident {
      const museum = useMuseumStore()
      const inc: ClosureIncident = {
        id: uid('INC'),
        ...input,
        status: 'active',
        createdAt: museum.nowISO,
        createdBy: by,
      }
      this.incidents.unshift(inc)
      museum.setMaintenance(input.hallId, {
        start: input.start,
        end: input.end,
        reason: input.reason,
      })
      this.syncRecords(inc.id)
      return inc
    },

    /** 恢复开放：闭展影响结束，事件进入运营复盘 */
    resolveIncident(id: string, _by: string) {
      const museum = useMuseumStore()
      const inc = this.incidentById(id)
      if (!inc || inc.status !== 'active') return
      inc.status = 'resolved'
      inc.resolvedAt = museum.nowISO
      museum.clearMaintenance(inc.hallId)
    },

    /** 从当日预约筛出受影响团队，为新增团队补建处置记录 */
    syncRecords(incidentId: string) {
      const store = useReservationsStore()
      const inc = this.incidentById(incidentId)
      if (!inc) return
      for (const { reservation } of affectedByIncident(store.list, inc)) {
        if (!this.records.some((r) => r.incidentId === incidentId && r.resId === reservation.id)) {
          this.records.push({ id: uid('DIV'), incidentId, resId: reservation.id, status: 'pending' })
        }
      }
    },

    /** 批量通知联系人：通知内容写入各预约时间线，记录置为已通知 */
    notify(incidentId: string, resIds: string[], by: string) {
      const store = useReservationsStore()
      const museum = useMuseumStore()
      const inc = this.incidentById(incidentId)
      if (!inc) return
      const hall = museum.hallById(inc.hallId)
      const message =
        `【云川美术馆】因「${hall?.name ?? inc.hallId}」${inc.reason}` +
        `（${CLOSURE_CATEGORY_LABEL[inc.category]}），${inc.start}-${inc.end} 临时闭展，` +
        `贵团行程将调整，替代路线、预计等待与可换讲解主题请与前台确认。`
      for (const resId of resIds) {
        store.notifyClosure(resId, message, by)
        const rec = this.recordFor(incidentId, resId)
        if (rec && rec.status === 'pending') {
          rec.status = 'notified'
          rec.notifiedAt = museum.nowISO
          rec.notifyBy = by
        }
      }
    },

    /** 记录某团队的分流处置决策，并联动预约路线/退款/改期/投诉 */
    decide(incidentId: string, resId: string, payload: DecidePayload, by: string) {
      const store = useReservationsStore()
      const museum = useMuseumStore()
      const inc = this.incidentById(incidentId)
      const r = store.byId(resId)
      if (!inc || !r) return
      const rec = this.recordFor(incidentId, resId)
      const hallName = museum.hallById(inc.hallId)?.name ?? inc.hallId

      switch (payload.decision) {
        case 'accept_alt':
          store.divertFromClosedHall(
            resId,
            {
              closedHallId: inc.hallId,
              targetHallId: payload.targetHallId,
              atHM: museum.nowHM,
              durationMin: payload.durationMin,
              reason: `闭展分流（${inc.reason}）`,
            },
            by,
          )
          if (rec) rec.altHallId = payload.targetHallId
          break
        case 'theme_switch':
          // 正身处闭展厅的团队先终止该站，再按新主题重排
          store.markClosedStop(resId, inc.hallId, '闭展，已切换讲解主题')
          store.switchTheme(resId, payload.themeId, `闭展分流（${inc.reason}）`, by)
          if (rec) rec.altThemeId = payload.themeId
          break
        case 'wait_reopen': {
          const stop = r.route.find(
            (s) => s.hallId === inc.hallId && s.state !== 'done' && s.state !== 'skipped',
          )
          const waitMin = stop ? waitEstimateMin(inc, stop, museum.nowHM) : 0
          store.waitForReopen(resId, inc.hallId, inc.end, waitMin, by)
          if (rec) rec.waitMin = waitMin
          break
        }
        case 'refund':
          store.applyRefund(
            resId,
            inc.hallId,
            payload.amount,
            `「${hallName}」临时闭展（${inc.reason}），团队拒绝替代路线`,
            by,
          )
          if (rec) rec.refundAmount = payload.amount
          break
        case 'reschedule': {
          const nr = store.reschedule(resId, payload.newArriveISO, by)
          if (rec) {
            rec.rescheduleTo = payload.newArriveISO
            rec.newResId = nr?.id
          }
          break
        }
        case 'complaint':
          store.addComplaint(resId, payload.text, r.contactName)
          store.markClosedStop(resId, inc.hallId, '闭展投诉登记，站点终止参观待复盘')
          if (rec) rec.complaintText = payload.text
          break
      }
      if (rec) {
        rec.status = 'done'
        rec.decision = payload.decision
        rec.handledBy = by
        rec.handledAt = museum.nowISO
      }
    },

    /** 讲解员端：已同步新的讲解重点 */
    ackByGuide(incidentId: string, resId: string, guideName: string) {
      const store = useReservationsStore()
      const museum = useMuseumStore()
      const rec = this.recordFor(incidentId, resId)
      const r = store.byId(resId)
      if (!rec || !r || rec.guideAckAt) return
      rec.guideAckAt = museum.nowISO
      store.log(r, 'guide_ack', `讲解员 ${guideName} 已同步闭展后的新讲解重点`, museum.nowISO, guideName)
    },

    /** 运营复盘：保存闭展原因复盘结论 */
    saveReview(id: string, text: string, by: string) {
      const museum = useMuseumStore()
      const inc = this.incidentById(id)
      if (!inc) return
      inc.review = text
      inc.reviewedBy = by
      inc.reviewedAt = museum.nowISO
    },

    resetAll() {
      const seed = seedClosures()
      this.incidents = seed.incidents
      this.records = seed.records
    },
  },

  persist: { key: 'museum-closures' },
})
