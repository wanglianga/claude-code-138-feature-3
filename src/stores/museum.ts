import { defineStore } from 'pinia'
import {
  GUIDES,
  HALLS,
  HEADSET_DEPOSIT,
  SECURITY_LANES,
  THEMES,
} from '@/data/museum'
import { seedHeadsets, seedIncidents } from '@/data/seed'
import { addHM, hmOfISO } from '@/lib/time'
import type {
  ClosureIncident,
  DeviceUnit,
  DeviceStatus,
  Guide,
  Hall,
  HallClosure,
  HallWarning,
  SecurityLane,
  Theme,
} from '@/types'

interface MuseumState {
  halls: Hall[]
  guides: Guide[]
  lanes: SecurityLane[]
  themes: Theme[]
  headsets: DeviceUnit[]
  depositPerUnit: number
  /** 工作人员实时登记的临时维护：hallId -> 闭馆时段 */
  maintenance: Record<string, HallClosure>
  /** 散客实时占用录入 */
  extraLoad: Record<string, number>
  /** 临时闭展（设备故障）事件，含受影响团队处置单 */
  incidents: ClosureIncident[]
  /** 复盘后挂到展厅的预警说明 */
  warnings: HallWarning[]
  nowHM: string
  running: boolean
}

let timer: ReturnType<typeof setInterval> | null = null

export const useMuseumStore = defineStore('museum', {
  state: (): MuseumState => ({
    halls: JSON.parse(JSON.stringify(HALLS)) as Hall[],
    guides: JSON.parse(JSON.stringify(GUIDES)) as Guide[],
    lanes: JSON.parse(JSON.stringify(SECURITY_LANES)) as SecurityLane[],
    themes: JSON.parse(JSON.stringify(THEMES)) as Theme[],
    headsets: seedHeadsets(),
    depositPerUnit: HEADSET_DEPOSIT,
    maintenance: {},
    extraLoad: { h2: 28, h5: 10 },
    incidents: seedIncidents(),
    warnings: [],
    nowHM: '10:25',
    running: false,
  }),

  getters: {
    hallById: (s) => (id: string) => s.halls.find((h) => h.id === id),
    themeById: (s) => (id: string) => s.themes.find((t) => t.id === id),
    guideById: (s) => (id: string) => s.guides.find((g) => g.id === id),
    nowISO: (s) => `2026-10-01T${s.nowHM}:00`,
    inventory(s) {
      const c = { available: 0, lent: 0, returned: 0, damaged: 0, lost: 0 }
      for (const d of s.headsets) c[d.status]++
      return c
    },
    activeIncidents: (s) => s.incidents.filter((i) => i.status === 'active'),
    incidentById: (s) => (id: string) => s.incidents.find((i) => i.id === id),
    warningByHall: (s) => (hallId: string) => s.warnings.find((w) => w.hallId === hallId),
  },

  actions: {
    setNow(hm: string) {
      this.nowHM = hm
    },
    tick() {
      this.nowHM = addHM(this.nowHM, 1)
      if (this.nowHM > '18:00') this.pauseSimulation()
    },
    startSimulation() {
      if (this.running) return
      this.running = true
      timer = setInterval(() => this.tick(), 2000)
    },
    pauseSimulation() {
      this.running = false
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    resetClock() {
      this.pauseSimulation()
      this.nowHM = '10:25'
    },

    setMaintenance(hallId: string, closure: HallClosure) {
      this.maintenance[hallId] = closure
    },
    clearMaintenance(hallId: string) {
      delete this.maintenance[hallId]
    },
    setExtraLoad(hallId: string, n: number) {
      if (n > 0) this.extraLoad[hallId] = n
      else delete this.extraLoad[hallId]
    },

    // ---------- 临时闭展事件 ----------
    addIncident(incident: ClosureIncident) {
      this.incidents.unshift(incident)
    },
    updateIncident(id: string, patch: Partial<ClosureIncident>) {
      const i = this.incidents.find((x) => x.id === id)
      if (i) Object.assign(i, patch)
    },
    resolveIncident(id: string, endHM: string, note: string) {
      const i = this.incidents.find((x) => x.id === id)
      if (!i) return
      i.status = 'resolved'
      i.end = endHM
      i.resolvedAt = this.nowISO
      i.resolvedNote = note
    },
    /** 闭展结束：恢复展厅（解除维护登记） */
    reopenHall(hallId: string) {
      this.clearMaintenance(hallId)
    },
    setWarning(w: HallWarning) {
      const i = this.warnings.findIndex((x) => x.hallId === w.hallId)
      if (i >= 0) this.warnings.splice(i, 1, w)
      else this.warnings.push(w)
    },
    clearWarning(hallId: string) {
      this.warnings = this.warnings.filter((w) => w.hallId !== hallId)
    },

    /** 从在库设备中取 n 台，返回设备编码（不足时返回全部可用） */
    lendFromPool(n: number, resId: string, atISO: string): DeviceUnit[] {
      const picked: DeviceUnit[] = []
      for (const d of this.headsets) {
        if (picked.length >= n) break
        if (d.status === 'available') {
          d.status = 'lent'
          d.resId = resId
          d.lentAt = atISO
          d.returnedAt = undefined
          d.damageFee = undefined
          d.note = undefined
          picked.push({ ...d })
        }
      }
      return picked
    },

    syncPoolDevice(
      code: string,
      status: DeviceStatus,
      fields: Partial<DeviceUnit> = {},
    ) {
      const d = this.headsets.find((x) => x.code === code)
      if (!d) return
      d.status = status
      Object.assign(d, fields)
      if (status === 'available' || status === 'returned') {
        d.resId = undefined
      }
    },

    /** 途中换机：旧机损坏待赔，从池里补一台新机借出 */
    exchangeFromPool(oldCode: string, resId: string, atISO: string, note: string): string | null {
      this.syncPoolDevice(oldCode, 'damaged', { note, damageFee: 50 })
      const [fresh] = this.lendFromPool(1, resId, atISO)
      return fresh?.code ?? null
    },

    resetAll() {
      this.pauseSimulation()
      this.$patch({
        headsets: seedHeadsets(),
        maintenance: {},
        extraLoad: { h2: 28, h5: 10 },
        incidents: seedIncidents(),
        warnings: [],
        nowHM: hmOfISO('2026-10-01T10:25:00'),
      })
    },
  },

  persist: {
    key: 'museum-world',
    pick: ['maintenance', 'extraLoad', 'nowHM', 'headsets', 'incidents', 'warnings'],
  },
})
