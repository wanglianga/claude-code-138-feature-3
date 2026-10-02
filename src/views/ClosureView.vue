<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMuseumStore } from '@/stores/museum'
import { useReservationsStore } from '@/stores/reservations'
import { useSessionStore } from '@/stores/session'
import { closureAlternative, closureReview, occupancyGrid } from '@/lib/schedule'
import { addHM } from '@/lib/time'
import { REFUND_RATIOS, TOUR_FEE_PER_PERSON } from '@/data/museum'
import CapacityBar from '@/components/CapacityBar.vue'
import HallTags from '@/components/HallTags.vue'
import type { ClosureTeamPlan, GuideBriefing, Reservation, TeamPlanStatus } from '@/types'

const museum = useMuseumStore()
const store = useReservationsStore()
const session = useSessionStore()

const tab = ref<'dispatch' | 'guide'>('dispatch')

// ---------- 事件选择 ----------
const incidents = computed(() =>
  [...museum.incidents].sort((a, b) => b.declaredAt.localeCompare(a.declaredAt)),
)
const activeIncidents = computed(() => incidents.value.filter((i) => i.status === 'active'))
const selectedIncidentId = ref(activeIncidents.value[0]?.id ?? incidents.value[0]?.id ?? '')
const incident = computed(() => museum.incidentById(selectedIncidentId.value))

const grid = computed(() =>
  occupancyGrid(store.list, { maintenance: museum.maintenance, extraLoad: museum.extraLoad }),
)

// ---------- 声明闭展 ----------
const showDeclare = ref(false)
const fHallId = ref('h5')
const fReason = ref('投影设备故障')
const fStart = ref('')
const fEnd = ref('')

function openDeclare() {
  // 默认选中当前正在参观的展厅
  const touring = store.list.find((x) => x.status === 'touring')
  fHallId.value = touring?.route.find((s) => s.state === 'current')?.hallId ?? museum.halls[0].id
  fReason.value = '投影设备故障'
  fStart.value = museum.nowHM
  fEnd.value = addHM(museum.nowHM, 60)
  showDeclare.value = true
}
function declareClosure() {
  const inc = store.declareClosure(
    {
      hallId: fHallId.value,
      reason: fReason.value.trim() || '设备故障',
      start: fStart.value || museum.nowHM,
      expectedEnd: fEnd.value || addHM(museum.nowHM, 60),
    },
    session.staffName,
  )
  selectedIncidentId.value = inc.id
  showDeclare.value = false
}

// ---------- 受影响团队 ----------
const rows = computed(() => {
  const inc = incident.value
  if (!inc) return []
  return Object.keys(inc.plans)
    .map((resId) => {
      const r = store.byId(resId)
      if (!r) return null
      return {
        resId,
        orgName: r.orgName,
        size: r.verifiedSize ?? r.groupSize,
        contactName: r.contactName,
        contactPhone: r.contactPhone,
        guideNames: r.assignedGuideIds.map((g) => museum.guideById(g)?.name).join('、'),
        plan: inc.plans[resId],
        reservation: r,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a!.resId.localeCompare(b!.resId)) as Array<{
      resId: string
      orgName: string
      size: number
      contactName: string
      contactPhone: string
      guideNames: string
      plan: ClosureTeamPlan
      reservation: Reservation
    }>
})

/** 实时计算某团队的替代路线与可换主题（未决定时使用） */
function altFor(resId: string) {
  const inc = incident.value
  const r = store.byId(resId)
  if (!inc || !r || !inc.end) return null
  return closureAlternative(r, inc.hallId, {
    startHM: inc.start,
    expectEndHM: inc.end,
    halls: museum.halls,
    themes: museum.themes,
    guides: museum.guides,
    grid: grid.value,
    live: { maintenance: museum.maintenance, extraLoad: museum.extraLoad },
    nowHM: museum.nowHM,
  })
}

const PLAN_LABEL: Record<TeamPlanStatus, string> = {
  identified: '待处置',
  notified: '已通知·待答复',
  rerouted: '已接受改线',
  refunded: '已部分退款',
  rescheduled: '已改期',
  complaint: '投诉登记',
}
const DECIDED: TeamPlanStatus[] = ['rerouted', 'refunded', 'rescheduled', 'complaint']
function isDecided(s: TeamPlanStatus) {
  return DECIDED.includes(s)
}
/** 该团在本次闭展下的退款/改期/投诉结果（只读展示） */
function refundOf(resId: string) {
  const inc = incident.value
  const r = store.byId(resId)
  if (!inc) return undefined
  return [...(r?.refunds ?? [])].reverse().find((x) => x.incidentId === inc.id)
}
const PLAN_CLASS: Record<TeamPlanStatus, string> = {
  identified: 'tag-warn',
  notified: '',
  rerouted: 'tag-ok',
  refunded: 'tag-maint',
  rescheduled: 'tag-acc',
  complaint: 'tag-maint',
}

const checked = ref<Set<string>>(new Set())
function toggleCheck(id: string) {
  if (checked.value.has(id)) checked.value.delete(id)
  else checked.value.add(id)
}
const checkAll = computed({
  get: () => rows.value.length > 0 && rows.value.every((x) => checked.value.has(x.resId)),
  set(v: boolean) {
    checked.value = new Set(v ? rows.value.map((x) => x.resId) : [])
  },
})
const pendingRows = computed(() => rows.value.filter((x) => ['identified', 'notified'].includes(x.plan.status)))
function notifyChecked() {
  const ids = rows.value.filter((x) => checked.value.has(x.resId)).map((x) => x.resId)
  if (!ids.length) return
  store.notifyClosureContacts(selectedIncidentId.value, ids, session.staffName)
}

// ---------- 单团处置 ----------
const expandedId = ref('')
function toggleRow(id: string) {
  expandedId.value = expandedId.value === id ? '' : id
}

const targetHall = ref<Record<string, string>>({})
const stayMin = ref<Record<string, number>>({})
const switchTheme = ref<Record<string, string>>({})
const refundRatio = ref<Record<string, number>>({})
const rescheduleTo = ref<Record<string, string>>({})
const complaintText = ref<Record<string, string>>({})
const refuseReason = ref<Record<string, string>>({})

function rowTarget(id: string) {
  return targetHall.value[id] ?? ''
}
function suggestions(id: string) {
  return altFor(id)?.suggestions ?? []
}
function themeOptions(id: string) {
  const plan = incident.value?.plans[id]
  return (plan?.altThemeIds ?? []).map((t) => museum.themeById(t)!).filter(Boolean)
}
function feeBase(id: string) {
  const r = store.byId(id)
  return (r?.verifiedSize ?? r?.groupSize ?? 0) * TOUR_FEE_PER_PERSON
}
function refundAmount(id: string) {
  return Math.round((feeBase(id) * (refundRatio.value[id] ?? 20)) / 100)
}
function defaultReschedule(id: string) {
  return rescheduleTo.value[id] ?? '2026-10-08T10:00'
}
/** 闭展进行中按当前时刻实时计算等待；结束后沿用处置时固化值 */
function waitOf(id: string, fixed: number) {
  if (incident.value?.status !== 'active') return fixed
  return altFor(id)?.waitMin ?? fixed
}

function acceptAlt(id: string) {
  const hall = rowTarget(id)
  if (!hall) return
  const dur = stayMin.value[id] ?? 25
  const themeId = switchTheme.value[id]
  store.acceptClosureAlternative(
    selectedIncidentId.value,
    id,
    { targetHallId: hall, durationMin: dur, switchThemeId: themeId || undefined },
    session.staffName,
  )
  expandedId.value = ''
}
function doRefund(id: string) {
  store.refuseClosureAlternative(
    selectedIncidentId.value,
    id,
    'refund',
    { refundRatio: refundRatio.value[id] ?? 20, reason: refuseReason.value[id] },
    session.staffName,
  )
  expandedId.value = ''
}
function doReschedule(id: string) {
  store.refuseClosureAlternative(
    selectedIncidentId.value,
    id,
    'reschedule',
    { rescheduleTo: (rescheduleTo.value[id] || defaultReschedule(id)) + ':00', reason: refuseReason.value[id] },
    session.staffName,
  )
  expandedId.value = ''
}
function doComplaint(id: string) {
  const text = complaintText.value[id]?.trim()
  if (!text) return
  store.refuseClosureAlternative(selectedIncidentId.value, id, 'complaint', { complaint: text }, session.staffName)
  expandedId.value = ''
}

// ---------- 结束闭展 ----------
const resolveEnd = ref('')
const resolveNote = ref('')
function resolveIncident() {
  const inc = incident.value
  if (!inc) return
  store.resolveClosure(
    inc.id,
    resolveEnd.value || museum.nowHM,
    resolveNote.value.trim(),
    session.staffName,
  )
}

// ---------- 复盘（只读摘要） ----------
const review = computed(() => {
  const inc = incident.value
  return inc ? closureReview(inc, store.list) : null
})

// ---------- 讲解员端 ----------
interface BriefRow {
  resId: string
  orgName: string
  guideId: string
  guideName: string
  b: GuideBriefing
  read: boolean
}
const briefRows = computed<BriefRow[]>(() => {
  const out: BriefRow[] = []
  for (const r of store.list) {
    for (const b of r.briefings ?? []) {
      out.push({
        resId: r.id,
        orgName: r.orgName,
        guideId: b.guideId,
        guideName: museum.guideById(b.guideId)?.name ?? b.guideId,
        b,
        read: !!b.readAt,
      })
    }
  }
  return out.sort((a, b) => Number(a.read) - Number(b.read) || b.b.at.localeCompare(a.b.at))
})
const unreadCount = computed(() => briefRows.value.filter((x) => !x.read).length)
const guideFilter = ref('all')
const visibleBriefs = computed(() =>
  guideFilter.value === 'all' ? briefRows.value : briefRows.value.filter((x) => x.guideId === guideFilter.value),
)
function markRead(resId: string, briefingId: string) {
  store.markBriefingRead(resId, briefingId)
}
</script>

<template>
  <div class="toolbar">
    <div class="pill-row">
      <button
        v-for="inc in incidents" :key="inc.id"
        class="btn-sm"
        :style="inc.id === selectedIncidentId
          ? 'background:var(--ink);color:#f5f1e6;border-color:var(--ink)'
          : inc.status === 'active'
            ? 'border-color:var(--red);color:var(--red)'
            : ''"
        @click="selectedIncidentId = inc.id"
      >
        {{ inc.status === 'active' ? '🔴' : '✅' }} {{ museum.hallById(inc.hallId)?.name.replace(/^.*? · /, '') }}
        <span class="muted">{{ inc.start }}-{{ inc.end || '…' }}</span>
      </button>
    </div>
    <span style="flex:1"></span>
    <button class="btn-sm btn-danger" @click="openDeclare">🚨 登记设备故障闭展</button>
  </div>

  <!-- 声明闭展表单 -->
  <div v-if="showDeclare" class="card" style="margin-bottom:14px; border-color:var(--red)">
    <div class="card-title">设备故障临时闭展 <span class="aside">登记后自动从当日预约筛出受影响团队</span></div>
    <div class="form-row-3" style="display:grid; grid-template-columns:1.2fr 1fr 1fr 1fr auto; gap:10px; align-items:end">
      <div class="field" style="margin:0">
        <label>关闭展厅</label>
        <select v-model="fHallId">
          <option v-for="h in museum.halls" :key="h.id" :value="h.id">{{ h.name }}</option>
        </select>
      </div>
      <div class="field" style="margin:0"><label>故障原因</label><input v-model="fReason" placeholder="如：投影设备故障" /></div>
      <div class="field" style="margin:0"><label>起</label><input v-model="fStart" type="time" /></div>
      <div class="field" style="margin:0"><label>预计恢复</label><input v-model="fEnd" type="time" /></div>
      <button class="btn-danger" @click="declareClosure">广播闭展并筛团</button>
    </div>
  </div>

  <template v-if="incident">
    <!-- 闭展信息条 -->
    <div class="card" :style="incident.status === 'active' ? 'border-color:var(--red)' : ''" style="margin-bottom:14px">
      <div class="grid" style="grid-template-columns:1fr auto; gap:16px; align-items:center">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
            <h2 style="font-size:17px">{{ museum.hallById(incident.hallId)?.name }}</h2>
            <span class="tag" :class="incident.status === 'active' ? 'tag-maint' : 'tag-ok'">
              {{ incident.status === 'active' ? '🔴 闭展中' : '✅ 影响已结束' }}
            </span>
            <span v-if="museum.warningByHall(incident.hallId)" class="tag tag-warn">⚠ 已挂预警说明</span>
          </div>
          <div class="small muted" style="margin-top:6px">
            {{ incident.reason }} · {{ incident.start }}-{{ incident.end || '预计恢复待定' }}
            · 登记人 {{ incident.declaredBy }}（{{ incident.declaredAt.slice(11, 16) }}）
          </div>
          <div v-if="incident.resolvedNote" class="small" style="margin-top:4px">恢复说明：{{ incident.resolvedNote }}</div>
          <div v-if="museum.warningByHall(incident.hallId)" class="callout warn" style="margin:8px 0 0; padding:8px 11px">
            ⚠ 展厅预警说明（运营复盘后挂出）：{{ museum.warningByHall(incident.hallId)?.text }}
          </div>
        </div>
        <div v-if="incident.status === 'active'" style="display:flex; gap:8px; align-items:end; flex-wrap:wrap">
          <div class="field" style="margin:0"><label class="small">实际恢复</label><input v-model="resolveEnd" type="time" :placeholder="museum.nowHM" /></div>
          <input v-model="resolveNote" placeholder="恢复说明（可选）" style="width:200px" />
          <button class="btn-sm btn-gold" @click="resolveIncident">结束闭展影响 → 进入复盘</button>
        </div>
      </div>
      <HallTags style="margin-top:8px" :hall="museum.hallById(incident.hallId)!" />
    </div>

    <!-- 子页签 -->
    <div class="pill-row" style="margin-bottom:12px">
      <button class="btn-sm" :style="tab === 'dispatch' ? 'background:var(--ink);color:#f5f1e6;border-color:var(--ink)' : ''" @click="tab = 'dispatch'">
        🧭 团队分流处置（{{ rows.length }}）
      </button>
      <button class="btn-sm" :style="tab === 'guide' ? 'background:var(--ink);color:#f5f1e6;border-color:var(--ink)' : ''" @click="tab = 'guide'">
        🎙 讲解员端 · 讲解重点同步<span v-if="unreadCount" style="color:var(--red); margin-left:4px">● {{ unreadCount }} 未读</span>
      </button>
    </div>

    <!-- ============ 分流处置 ============ -->
    <template v-if="tab === 'dispatch'">
      <div v-if="!rows.length" class="card empty">
        该闭展事件没有筛出受影响的当日预约团队（已离馆/已跳过该厅的团队不计）。
      </div>

      <template v-else>
        <div class="card" style="margin-bottom:12px; display:flex; align-items:center; gap:12px; flex-wrap:wrap">
          <label class="checkbox"><input type="checkbox" :checked="checkAll" @change="checkAll = ($event.target as HTMLInputElement).checked" /> 全选</label>
          <button class="btn-sm btn-gold" :disabled="!checked.size" @click="notifyChecked">
            📞 批量通知已选联系人（{{ checked.size }}）
          </button>
          <span class="hint">通知将以工作群/短信方式发送：闭展原因、预计等待、替代路线与退款/改期选项。</span>
          <span style="flex:1"></span>
          <span class="small muted">待答复 {{ pendingRows.length }} 团</span>
        </div>

        <div class="card" style="padding:6px 0">
          <table class="data">
            <thead>
              <tr>
                <th style="width:34px"></th>
                <th>团体 / 联系人</th><th>人数</th><th>受阻 · 预计等待</th>
                <th>替代路线建议</th><th>可换主题</th><th>讲解员</th><th>处置状态</th><th></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in rows" :key="row.resId">
                <tr>
                  <td><input type="checkbox" :checked="checked.has(row.resId)" @change="toggleCheck(row.resId)" /></td>
                  <td>
                    <strong style="font-size:13px">{{ row.orgName }}</strong>
                    <div class="small muted">{{ row.contactName }} · {{ row.contactPhone }}</div>
                    <div class="small mono muted">{{ row.resId }}</div>
                  </td>
                  <td class="mono">{{ row.size }}</td>
                  <td class="small">
                    {{ museum.hallById(row.plan.blockedHallId)?.name.replace(/^.*? · /, '') }}
                    <div :style="waitOf(row.resId, row.plan.waitMin) >= 30 ? 'color:var(--red);font-weight:600' : 'color:var(--amber)'">
                      ⏱ 预计等待 {{ waitOf(row.resId, row.plan.waitMin) }} 分钟
                    </div>
                  </td>
                  <td class="small">
                    <template v-if="row.plan.appliedHallId">
                      已改至 <strong>{{ museum.hallById(row.plan.appliedHallId)?.name.replace(/^.*? · /, '') }}</strong>
                    </template>
                    <template v-else-if="row.plan.suggestedHallId">
                      建议 → {{ museum.hallById(row.plan.suggestedHallId)?.name.replace(/^.*? · /, '') }}
                    </template>
                    <template v-else>—</template>
                  </td>
                  <td class="small">
                    <span v-if="row.plan.switchedThemeId" class="tag tag-ok">已换 {{ museum.themeById(row.plan.switchedThemeId)?.name }}</span>
                    <span v-else-if="row.plan.themeSwitchable" class="tag tag-ok">可换（{{ row.plan.altThemeIds.length }}）</span>
                    <span v-else class="tag">否</span>
                  </td>
                  <td class="small">{{ row.guideNames || '—' }}</td>
                  <td><span class="tag" :class="PLAN_CLASS[row.plan.status]">{{ PLAN_LABEL[row.plan.status] }}</span></td>
                  <td class="small" style="white-space:nowrap">
                    <button class="btn-sm" @click="toggleRow(row.resId)">
                      {{ expandedId === row.resId ? '收起' : '处置' }}
                    </button>
                  </td>
                </tr>

                <!-- 处置面板 -->
                <tr v-if="expandedId === row.resId">
                  <td colspan="9" style="background:var(--paper); padding:16px">
                    <!-- 已结束闭展：只读 -->
                    <div v-if="incident.status !== 'active'" class="small muted">
                      闭展影响已结束，处置结果已归档；投诉率与满意度见运营看板复盘区。
                    </div>

                    <!-- 闭展进行中但该团已有终态处置：只读结果 -->
                    <div v-else-if="isDecided(row.plan.status)" class="callout ok" style="margin:0">
                      <template v-if="row.plan.status === 'rerouted'">
                        ✓ 已接受替代路线，改至「{{ museum.hallById(row.plan.appliedHallId ?? '')?.name }}」，讲解重点已同步讲解员
                        <span v-if="row.plan.switchedThemeId">；讲解主题已切换为「{{ museum.themeById(row.plan.switchedThemeId)?.name }}」</span>。
                      </template>
                      <template v-else-if="row.plan.status === 'refunded'">
                        ✕ 团队拒绝替代路线，已办理部分退款 <strong class="money">¥{{ refundOf(row.resId)?.amount }}</strong>
                        （{{ refundOf(row.resId)?.ratio }}%）。<span class="muted">{{ refundOf(row.resId)?.reason }}</span>
                      </template>
                      <template v-else-if="row.plan.status === 'rescheduled'">
                        ✕ 团队拒绝替代路线，已改期至 <strong>{{ store.byId(row.resId)?.rescheduledTo?.slice(0, 16).replace('T', ' ') }}</strong>，预约状态为「改期待约」。
                      </template>
                      <template v-else>
                        ✕ 团队拒绝替代路线，已登记投诉：<span style="color:var(--red)">{{ store.byId(row.resId)?.complaint }}</span>
                      </template>
                      <div class="small muted" style="margin-top:4px">处置时间 {{ row.plan.decidedAt?.slice(11, 16) }}，进入本闭展事件复盘统计。</div>
                    </div>

                    <template v-else>
                      <div class="grid grid-2" style="align-items:start">
                        <!-- 接受替代路线 -->
                        <div class="tight" style="border:1px solid var(--green); border-radius:9px; padding:13px">
                          <strong style="color:var(--green)">✓ 团队接受替代路线 / 换主题</strong>
                          <div class="field" style="margin-top:10px">
                            <label class="small">替代展厅（系统按同主题/儿童友好/相邻/满载率推荐）</label>
                            <select v-model="targetHall[row.resId]">
                              <option value="" disabled>选择替代展厅</option>
                              <option v-for="sug in suggestions(row.resId)" :key="sug.hall.id" :value="sug.hall.id">
                                {{ sug.hall.name }}（满载率 {{ Math.round(sug.ratio * 100) }}%，{{ sug.enterHM }} 可进场）
                              </option>
                            </select>
                            <div v-for="sug in suggestions(row.resId).slice(0,1)" :key="sug.hall.id" class="small muted" style="margin-top:4px">
                              {{ sug.reasons.join('；') }}
                            </div>
                            <div v-if="!suggestions(row.resId).length" class="small" style="color:var(--red)">暂无可推荐展厅（均在维护/已参观）。</div>
                          </div>
                          <div class="form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
                            <div class="field" style="margin:0">
                              <label class="small">停留（分钟）</label>
                              <input v-model.number="stayMin[row.resId]" type="number" min="10" max="60" placeholder="25" />
                            </div>
                            <div class="field" style="margin:0">
                              <label class="small">同时换讲解主题（讲解员可讲）</label>
                              <select v-model="switchTheme[row.resId]">
                                <option value="">保持原主题</option>
                                <option v-for="t in themeOptions(row.resId)" :key="t.id" :value="t.id">{{ t.name }}</option>
                              </select>
                            </div>
                          </div>
                          <button class="btn-sm btn-gold" style="margin-top:10px" :disabled="!rowTarget(row.resId)" @click="acceptAlt(row.resId)">
                            确认改道、顺延后续站点并同步讲解重点
                          </button>
                        </div>

                        <!-- 拒绝替代路线 -->
                        <div class="tight" style="border:1px solid var(--red); border-radius:9px; padding:13px">
                          <strong style="color:var(--red)">✕ 团队拒绝替代路线</strong>
                          <div class="field" style="margin-top:10px; margin-bottom:8px">
                            <label class="small">部分退款（讲解服务费 ¥{{ feeBase(row.resId) }} = {{ row.size }} 人 × ¥{{ TOUR_FEE_PER_PERSON }}）</label>
                            <div class="pill-row">
                              <button v-for="ratio in REFUND_RATIOS" :key="ratio" class="btn-sm"
                                      :style="(refundRatio[row.resId] ?? 20) === ratio ? 'border-color:var(--red);color:var(--red)' : ''"
                                      @click="refundRatio[row.resId] = ratio">
                                退 {{ ratio }}% · ¥{{ Math.round(feeBase(row.resId) * ratio / 100) }}
                              </button>
                            </div>
                            <button class="btn-sm btn-danger" style="margin-top:8px" @click="doRefund(row.resId)">
                              办理退款 ¥{{ refundAmount(row.resId) }}
                            </button>
                          </div>
                          <hr class="divider" />
                          <div class="field" style="margin-bottom:8px">
                            <label class="small">改期至</label>
                            <input :value="rescheduleTo[row.resId] ?? '2026-10-08T10:00'"
                                   @input="rescheduleTo[row.resId] = ($event.target as HTMLInputElement).value"
                                   type="datetime-local" />
                            <button class="btn-sm" style="margin-top:6px" @click="doReschedule(row.resId)">登记改期（状态转「改期待约」）</button>
                          </div>
                          <hr class="divider" />
                          <div class="field" style="margin-bottom:6px">
                            <label class="small">投诉登记</label>
                            <textarea v-model="complaintText[row.resId]" placeholder="记录团队拒绝原因与诉求，进入运营复盘"></textarea>
                            <button class="btn-sm btn-danger" :disabled="!complaintText[row.resId]?.trim()" @click="doComplaint(row.resId)">登记投诉</button>
                          </div>
                        </div>
                      </div>

                      <!-- 实时满载率小卡 -->
                      <div class="grid grid-4" style="margin-top:12px; gap:8px">
                        <div v-for="sug in suggestions(row.resId)" :key="sug.hall.id" class="tight"
                             style="border:1px solid var(--line); border-radius:8px; padding:8px 10px">
                          <div style="display:flex; justify-content:space-between; align-items:center">
                            <strong class="small">{{ sug.hall.name.replace(/^.*? · /, '') }}</strong>
                            <CapacityBar :load="Math.round(sug.ratio * sug.hall.capacity)" :capacity="sug.hall.capacity" compact />
                          </div>
                        </div>
                      </div>
                    </template>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <!-- ============ 讲解员端 ============ -->
    <template v-else>
      <div class="card" style="margin-bottom:12px; display:flex; align-items:center; gap:10px">
        <span class="hint">讲解员视角：按讲解员筛选，查看闭展后同步的新讲解重点并确认已读。</span>
        <span style="flex:1"></span>
        <select v-model="guideFilter" style="width:160px">
          <option value="all">全部讲解员</option>
          <option v-for="g in museum.guides" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
      </div>

      <div v-if="!visibleBriefs.length" class="card empty">暂无讲解重点同步记录。</div>
      <div v-else class="grid" style="gap:12px">
        <div v-for="x in visibleBriefs" :key="x.b.id" class="card tight" :style="!x.read ? 'border-color:var(--gold)' : ''">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
            <strong>🎙 {{ x.guideName }}</strong>
            <span class="small muted">{{ x.orgName }}（{{ x.resId }}）</span>
            <span v-if="x.b.targetHallName" class="tag tag-ok">替代展厅：{{ x.b.targetHallName.replace(/^.*? · /, '') }}</span>
            <span style="flex:1"></span>
            <span class="small mono muted">同步 {{ x.b.at.slice(11, 16) }}</span>
            <span v-if="x.read" class="tag tag-ok">✓ 已读 {{ x.b.readAt?.slice(11, 16) }}</span>
            <button v-else class="btn-sm btn-gold" @click="markRead(x.resId, x.b.id)">确认已读</button>
          </div>
          <ol style="margin:9px 0 0; padding-left:20px">
            <li v-for="(p, i) in x.b.points" :key="i" class="small" style="margin-bottom:3px">{{ p }}</li>
          </ol>
        </div>
      </div>
    </template>

    <!-- 复盘摘要（已结束） -->
    <div v-if="incident.status === 'resolved' && review" class="card" style="margin-top:14px">
      <div class="card-title">闭展复盘摘要 <span class="aside">详细指标与预警决策见运营看板</span></div>
      <div class="grid grid-4">
        <div class="tight"><div class="stat-label">受影响 / 接受改线</div><div class="stat-num">{{ review.affected }}<span style="font-size:15px"> / {{ review.rerouted }}</span></div></div>
        <div class="tight"><div class="stat-label">拒绝（退款/改期/投诉）</div><div class="stat-num">{{ review.refused }}</div><div class="small muted">退款 ¥{{ review.refundTotal }}</div></div>
        <div class="tight"><div class="stat-label">被改线团队投诉率</div><div class="stat-num" :style="review.complaintRate >= 0.25 ? 'color:var(--red)' : ''">{{ Math.round(review.complaintRate * 100) }}%</div></div>
        <div class="tight"><div class="stat-label">满意度均值</div><div class="stat-num stars">{{ review.avgSatisfaction?.toFixed(1) ?? '—' }}</div></div>
      </div>
      <div v-if="incident.reviewNote" class="callout ok" style="margin-top:12px; margin-bottom:0">复盘结论：{{ incident.reviewNote }}</div>
    </div>
  </template>

  <div v-else class="card empty">暂无闭展事件。点击右上角「登记设备故障闭展」开始分流。</div>
</template>
