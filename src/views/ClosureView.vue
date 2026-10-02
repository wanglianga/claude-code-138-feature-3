<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMuseumStore } from '@/stores/museum'
import { useReservationsStore } from '@/stores/reservations'
import { useClosuresStore } from '@/stores/closures'
import { useSessionStore } from '@/stores/session'
import {
  affectedByIncident,
  incidentStats,
  reopenEnterHM,
  suggestRefund,
  switchableThemes,
  waitEstimateMin,
} from '@/lib/closure'
import { occupancyGrid, suggestReroute } from '@/lib/schedule'
import { addHM, hmOfISO } from '@/lib/time'
import {
  CLOSURE_CATEGORY_LABEL,
  DIVERSION_DECISION_LABEL,
  type ClosureCategory,
  type DiversionRecord,
} from '@/types'
import StatusBadge from '@/components/StatusBadge.vue'
import CapacityBar from '@/components/CapacityBar.vue'
import HallTags from '@/components/HallTags.vue'

const museum = useMuseumStore()
const store = useReservationsStore()
const closures = useClosuresStore()
const session = useSessionStore()

// —— 登记临时闭展 ——
const form = ref({ hallId: '', category: 'equipment' as ClosureCategory, reason: '', start: '', end: '' })
function declareIncident() {
  if (!form.value.hallId) return
  const inc = closures.declareIncident(
    {
      hallId: form.value.hallId,
      category: form.value.category,
      reason: form.value.reason || CLOSURE_CATEGORY_LABEL[form.value.category] + '，临时关闭',
      start: form.value.start || museum.nowHM,
      end: form.value.end || addHM(museum.nowHM, 60),
    },
    session.staffName,
  )
  selectedId.value = inc.id
  form.value = { hallId: '', category: 'equipment', reason: '', start: '', end: '' }
  flash(`已登记闭展：${museum.hallById(inc.hallId)?.name}，全馆容量与改道建议已联动`)
}

// —— 事件选择 ——
const selectedId = ref('')
const incident = computed(() => closures.incidentById(selectedId.value))
watch(
  () => closures.active.map((i) => i.id).join(','),
  () => {
    if (!selectedId.value || !closures.incidentById(selectedId.value)) {
      selectedId.value = closures.active[0]?.id ?? ''
    }
  },
  { immediate: true },
)
// 受影响团队可能随新预约/状态变化，进入或名单变化时重新筛选
watch([selectedId, () => store.list.length], () => {
  if (selectedId.value) closures.syncRecords(selectedId.value)
}, { immediate: true })

const grid = computed(() =>
  occupancyGrid(store.list, { maintenance: museum.maintenance, extraLoad: museum.extraLoad }),
)

/** 受影响团队行：替代路线建议 / 预计等待 / 可换主题 / 退款估算 / 处置记录 */
const rows = computed(() => {
  const inc = incident.value
  if (!inc || inc.status !== 'active') return []
  return affectedByIncident(store.list, inc).map(({ reservation: r, stop }) => ({
    r,
    stop,
    sugs: suggestReroute(r, inc.hallId, museum.halls, grid.value, {
      maintenance: museum.maintenance,
      extraLoad: museum.extraLoad,
    }, museum.nowHM),
    waitMin: waitEstimateMin(inc, stop, museum.nowHM),
    themes: switchableThemes(r, museum.themes, museum.halls, museum.maintenance, museum.guides, museum.nowHM),
    refund: suggestRefund(r, inc.hallId),
    rec: closures.recordFor(inc.id, r.id),
  }))
})

const doneRecords = computed(() =>
  selectedId.value ? closures.recordsOf(selectedId.value).filter((x) => x.status === 'done') : [],
)
const notifiedCount = computed(() =>
  selectedId.value
    ? closures.recordsOf(selectedId.value).filter((x) => x.status !== 'pending').length
    : 0,
)

// —— 批量通知 ——
const checked = ref<Record<string, boolean>>({})
const checkedIds = computed(() =>
  rows.value.filter((x) => checked.value[x.r.id] && x.rec?.status !== 'done').map((x) => x.r.id),
)
const allChecked = computed({
  get: () => rows.value.length > 0 && rows.value.every((x) => x.rec?.status === 'done' || checked.value[x.r.id]),
  set: (v: boolean) => {
    const next: Record<string, boolean> = {}
    if (v) for (const x of rows.value) if (x.rec?.status !== 'done') next[x.r.id] = true
    checked.value = next
  },
})
const notifyPreview = computed(() => {
  const inc = incident.value
  if (!inc) return ''
  const hall = museum.hallById(inc.hallId)
  return `【云川美术馆】因「${hall?.name}」${inc.reason}（${CLOSURE_CATEGORY_LABEL[inc.category]}），${inc.start}-${inc.end} 临时闭展，贵团行程将调整……`
})
function notifyChecked() {
  const ids = checkedIds.value
  if (!ids.length || !selectedId.value) return
  closures.notify(selectedId.value, ids, session.staffName)
  checked.value = {}
  flash(`已向 ${ids.length} 个团队联系人发送闭展分流通知（短信+电话回执），内容已写入各预约时间线`)
}

// —— 单团队处置面板 ——
const expandedId = ref('')
const panel = ref<'alt' | 'theme' | 'wait' | 'reject'>('alt')
const rejectTab = ref<'refund' | 'reschedule' | 'complaint'>('refund')
const altHallId = ref('')
const altDur = ref(25)
const themeId = ref('')
const refundAmt = ref(0)
const rescheduleISO = ref('')
const complaintText = ref('')

function expand(resId: string, p: typeof panel.value) {
  const row = rows.value.find((x) => x.r.id === resId)
  if (!row) return
  if (expandedId.value === resId && panel.value === p) {
    expandedId.value = ''
    return
  }
  expandedId.value = resId
  panel.value = p
  altHallId.value = row.sugs[0]?.hall.id ?? ''
  altDur.value = 25
  themeId.value = row.themes[0]?.theme.id ?? ''
  refundAmt.value = row.refund.amount
  rescheduleISO.value = `2026-10-02T${hmOfISO(row.r.arriveTime)}`
  complaintText.value = ''
  rejectTab.value = 'refund'
}

function decide(payload: Parameters<typeof closures.decide>[2]) {
  if (!selectedId.value || !expandedId.value) return
  const orgName = store.byId(expandedId.value)?.orgName ?? ''
  closures.decide(selectedId.value, expandedId.value, payload, session.staffName)
  flash(`已办理「${orgName}」：${DIVERSION_DECISION_LABEL[payload.decision]}，讲解员端已同步新的讲解重点`)
  expandedId.value = ''
}

// —— 运营复盘 ——
const reviewRows = computed(() =>
  [...closures.incidents]
    .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'resolved' ? -1 : 1))
    .map((inc) => ({ inc, stats: incidentStats(closures.recordsOf(inc.id), store.list) })),
)
const reviewDraft = ref<Record<string, string>>({})
const warningDraft = ref<Record<string, string>>({})
watch(
  () => closures.incidents.map((i) => i.id).join(','),
  () => {
    for (const inc of closures.incidents) {
      if (!(inc.id in reviewDraft.value)) reviewDraft.value[inc.id] = inc.review ?? ''
      if (!(inc.id in warningDraft.value)) warningDraft.value[inc.id] = museum.hallWarnings[inc.hallId] ?? ''
    }
  },
  { immediate: true },
)
function saveReview(incidentId: string) {
  closures.saveReview(incidentId, reviewDraft.value[incidentId]?.trim() ?? '', session.staffName)
  flash('复盘结论已保存')
}
function saveWarning(hallId: string, incidentId: string) {
  museum.setHallWarning(hallId, warningDraft.value[incidentId] ?? '')
  flash(museum.hallWarnings[hallId] ? '展厅预警说明已生效，将在预约/确认/调度各页面展示' : '已清除该展厅预警说明')
}
function clearWarning(hallId: string, incidentId: string) {
  museum.clearHallWarning(hallId)
  warningDraft.value[incidentId] = ''
  flash('已清除该展厅预警说明')
}

function decisionDetail(rec: DiversionRecord): string {
  switch (rec.decision) {
    case 'accept_alt':
      return `替代展厅：${museum.hallById(rec.altHallId ?? '')?.name ?? '—'}`
    case 'theme_switch':
      return `新主题：${museum.themeById(rec.altThemeId ?? '')?.name ?? '—'}`
    case 'wait_reopen':
      return `等待约 ${rec.waitMin ?? 0} 分钟，站点顺延`
    case 'refund':
      return `退款 ¥${(rec.refundAmount ?? 0).toLocaleString()}`
    case 'reschedule':
      return `改期至 ${rec.rescheduleTo?.slice(0, 10)} ${rec.rescheduleTo ? hmOfISO(rec.rescheduleTo) : ''}${rec.newResId ? `（新预约 ${rec.newResId}）` : ''}`
    case 'complaint':
      return rec.complaintText ?? ''
    default:
      return ''
  }
}

// —— 轻提示 ——
const flashMsg = ref('')
let flashTimer: ReturnType<typeof setTimeout> | null = null
function flash(msg: string) {
  flashMsg.value = msg
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flashMsg.value = ''), 5000)
}
</script>

<template>
  <div v-if="flashMsg" class="callout ok" style="position:sticky; top:0; z-index:5">✓ {{ flashMsg }}</div>

  <!-- 登记 + 事件列表 -->
  <div class="grid" style="grid-template-columns: 330px 1fr; align-items:start; margin-bottom:14px">
    <div class="card">
      <div class="card-title">🚨 登记临时闭展</div>
      <div class="field">
        <label>闭展展厅</label>
        <select v-model="form.hallId">
          <option value="" disabled>选择展厅</option>
          <option v-for="h in museum.halls" :key="h.id" :value="h.id">{{ h.name }}</option>
        </select>
      </div>
      <div class="field">
        <label>闭展原因分类</label>
        <select v-model="form.category">
          <option v-for="(label, key) in CLOSURE_CATEGORY_LABEL" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <div class="field">
        <label>具体情况</label>
        <input v-model="form.reason" placeholder="如：恒温恒湿机组故障报警" />
      </div>
      <div class="form-row">
        <div class="field"><label>闭展起</label><input v-model="form.start" type="time" :placeholder="museum.nowHM" /></div>
        <div class="field"><label>预计恢复</label><input v-model="form.end" type="time" :placeholder="addHM(museum.nowHM, 60)" /></div>
      </div>
      <button class="btn-danger" style="width:100%" :disabled="!form.hallId" @click="declareIncident">
        登记闭展并筛选受影响团队
      </button>
      <div class="hint" style="margin-top:8px">登记后全馆容量栅格、预约确认与改道建议立即避开该厅；闭展原因将进入运营复盘。</div>
    </div>

    <div class="card">
      <div class="card-title">
        闭展事件
        <span class="aside">点击「分流处置」处理受影响团队；恢复开放后进入运营复盘</span>
      </div>
      <div v-if="!closures.incidents.length" class="empty small">今日暂无闭展事件。</div>
      <div v-for="inc in closures.incidents" :key="inc.id"
           class="tight" style="border:1px solid var(--line); border-radius:9px; padding:10px 13px; margin-bottom:9px"
           :style="inc.id === selectedId && inc.status === 'active' ? 'border-color:var(--red); box-shadow:0 0 0 3px rgba(176,74,59,.14)' : ''">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap">
          <div>
            <strong>{{ museum.hallById(inc.hallId)?.name }}</strong>
            <span class="tag tag-maint" style="margin-left:8px">{{ CLOSURE_CATEGORY_LABEL[inc.category] }}</span>
            <span v-if="inc.status === 'active'" class="tag tag-warn" style="margin-left:6px">闭展中</span>
            <span v-else class="tag tag-ok" style="margin-left:6px">已恢复 {{ inc.resolvedAt?.slice(11, 16) }}</span>
          </div>
          <div style="display:flex; gap:6px">
            <button v-if="inc.status === 'active'" class="btn-sm btn-gold" @click="selectedId = inc.id">分流处置 ▸</button>
            <button v-if="inc.status === 'active'" class="btn-sm" @click="closures.resolveIncident(inc.id, session.staffName); flash('展厅已恢复开放，事件进入运营复盘')">✓ 恢复开放</button>
          </div>
        </div>
        <div class="small muted" style="margin-top:5px">
          {{ inc.start }}-{{ inc.end }} · {{ inc.reason }} · 登记人 {{ inc.createdBy }} · 受影响 {{ closures.recordsOf(inc.id).length }} 团
        </div>
      </div>
    </div>
  </div>

  <!-- 分流处置 -->
  <div v-if="incident && incident.status === 'active'" class="card" style="margin-bottom:14px">
    <div class="card-title">
      受影响团队分流处置 · {{ museum.hallById(incident.hallId)?.name }}
      <span class="aside">
        当日预约筛出 {{ rows.length }} 团待处置 · 已通知 {{ notifiedCount }} · 已处置 {{ doneRecords.length }}
      </span>
    </div>

    <!-- 批量通知 -->
    <div class="callout info" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap">
      <label class="checkbox"><input v-model="allChecked" type="checkbox" /> 全选</label>
      <span class="small">已选 <strong>{{ checkedIds.length }}</strong> 个团队</span>
      <button class="btn-sm btn-gold" :disabled="!checkedIds.length" @click="notifyChecked">📨 批量通知联系人</button>
      <span class="hint">通知模板：{{ notifyPreview }}</span>
    </div>

    <div v-if="!rows.length" class="empty small">
      当日预约中没有经过该展厅的待处置团队（已处置团队见下方记录）。
    </div>

    <!-- 团队卡片 -->
    <div v-for="row in rows" :key="row.r.id" class="tight"
         style="border:1px solid var(--line); border-radius:9px; padding:12px 14px; margin-bottom:10px">
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
        <input v-if="row.rec?.status !== 'done'" v-model="checked[row.r.id]" type="checkbox" style="width:15px; height:15px" />
        <strong>{{ row.r.orgName }}</strong>
        <StatusBadge :status="row.r.status" />
        <span class="small muted">{{ row.r.verifiedSize ?? row.r.groupSize }} 人 · {{ row.r.contactName }} {{ row.r.contactPhone }}</span>
        <span class="small muted">到馆 {{ hmOfISO(row.r.arriveTime) }}</span>
        <span style="flex:1"></span>
        <span v-if="row.rec?.status === 'pending'" class="tag">未通知</span>
        <span v-else-if="row.rec?.status === 'notified'" class="tag tag-ok">已通知 {{ row.rec.notifiedAt?.slice(11, 16) }}</span>
      </div>

      <div class="small" style="margin:8px 0">
        受影响站点：<strong>{{ museum.hallById(row.stop.hallId)?.name }}</strong>
        {{ row.stop.state === 'current' ? `正在参观（${row.stop.actualEnter} 进场）` : `计划 ${row.stop.plannedEnter}~${row.stop.plannedLeave}` }}
      </div>

      <!-- 替代路线 / 预计等待 / 可换主题 -->
      <div class="grid grid-3" style="gap:10px; margin-bottom:10px">
        <div class="tight" style="border:1px dashed var(--line-strong); border-radius:8px; padding:9px 11px">
          <div class="stat-label">替代路线建议</div>
          <template v-if="row.sugs.length">
            <strong style="font-size:13px">{{ row.sugs[0].hall.name.replace(/^.*? · /, '') }}</strong>
            <span class="small muted"> 等 {{ row.sugs.length }} 个备选</span>
            <div style="margin:4px 0"><CapacityBar :load="Math.round(row.sugs[0].ratio * row.sugs[0].hall.capacity)" :capacity="row.sugs[0].hall.capacity" compact /></div>
            <div class="small muted">{{ row.sugs[0].reasons.slice(0, 2).join('；') }}</div>
          </template>
          <div v-else class="small muted">暂无空闲替代展厅</div>
        </div>
        <div class="tight" style="border:1px dashed var(--line-strong); border-radius:8px; padding:9px 11px">
          <div class="stat-label">预计等待（选择等待恢复）</div>
          <div class="stat-num" style="font-size:20px">{{ row.waitMin }}<span style="font-size:13px"> 分钟</span></div>
          <div class="small muted">约 {{ reopenEnterHM(incident) }} 恢复进场</div>
        </div>
        <div class="tight" style="border:1px dashed var(--line-strong); border-radius:8px; padding:9px 11px">
          <div class="stat-label">是否可换讲解主题</div>
          <template v-if="row.themes.length">
            <div v-for="t in row.themes" :key="t.theme.id" class="small">
              ✓ {{ t.theme.name }}<span class="muted">（{{ t.coverGuides.map((g) => g.name).join('、') }} 可讲）</span>
            </div>
          </template>
          <div v-else class="small muted">无可换主题（讲解员主题不匹配或其他展厅也在闭展）</div>
        </div>
      </div>

      <!-- 处置按钮 -->
      <div class="pill-row" style="gap:8px">
        <button class="btn-sm btn-gold" :disabled="!row.sugs.length" @click="expand(row.r.id, 'alt')">✓ 接受替代路线</button>
        <button class="btn-sm" :disabled="!row.themes.length" @click="expand(row.r.id, 'theme')">🔄 换讲解主题</button>
        <button class="btn-sm" style="border-color:var(--blue); color:var(--blue)" @click="expand(row.r.id, 'wait')">⏱ 等待恢复开放</button>
        <button class="btn-sm btn-danger" @click="expand(row.r.id, 'reject')">✕ 团队拒绝替代方案 ▸</button>
      </div>

      <!-- 处置面板 -->
      <div v-if="expandedId === row.r.id" style="margin-top:12px; border-top:1px dashed var(--line); padding-top:12px">
        <!-- 接受替代路线 -->
        <div v-if="panel === 'alt'">
          <div class="grid grid-2" style="gap:10px">
            <div v-for="sug in row.sugs" :key="sug.hall.id" class="tight"
                 style="border:1px solid var(--line); border-radius:9px; padding:10px 12px; cursor:pointer"
                 :style="altHallId === sug.hall.id ? 'border-color:var(--gold); box-shadow:0 0 0 3px rgba(201,178,128,.22)' : ''"
                 @click="altHallId = sug.hall.id">
              <div style="display:flex; justify-content:space-between; align-items:center">
                <strong style="font-size:13px">{{ sug.hall.name }}</strong>
                <CapacityBar :load="Math.round(sug.ratio * sug.hall.capacity)" :capacity="sug.hall.capacity" compact />
              </div>
              <HallTags :hall="sug.hall" :ratio="sug.ratio" />
              <div class="small muted" style="margin-top:5px">{{ sug.reasons.join('；') }}</div>
            </div>
          </div>
          <div class="form-row" style="margin-top:10px; align-items:end">
            <div class="field" style="margin:0">
              <label>替代展厅停留时长（分钟）</label>
              <input v-model.number="altDur" type="number" min="10" max="60" />
            </div>
            <button class="btn-gold" :disabled="!altHallId" @click="decide({ decision: 'accept_alt', targetHallId: altHallId, durationMin: altDur })">
              确认替代路线并顺延后续站点
            </button>
          </div>
        </div>

        <!-- 换讲解主题 -->
        <div v-else-if="panel === 'theme'">
          <div class="grid grid-2" style="gap:10px">
            <div v-for="t in row.themes" :key="t.theme.id" class="tight"
                 style="border:1px solid var(--line); border-radius:9px; padding:10px 12px; cursor:pointer"
                 :style="themeId === t.theme.id ? 'border-color:var(--gold); box-shadow:0 0 0 3px rgba(201,178,128,.22)' : ''"
                 @click="themeId = t.theme.id">
              <strong style="font-size:13px">{{ t.theme.name }}</strong>
              <div class="small muted" style="margin:4px 0">{{ t.theme.desc }}</div>
              <div class="small">剩余站点：{{ t.hallNames.join(' → ') }}</div>
              <div class="small" style="color:var(--green)">✓ {{ t.coverGuides.map((g) => g.name).join('、') }} 可讲该主题</div>
            </div>
          </div>
          <button class="btn-gold" style="margin-top:10px" :disabled="!themeId" @click="decide({ decision: 'theme_switch', themeId })">
            确认更换主题，未完成站点按新主题重排
          </button>
        </div>

        <!-- 等待恢复 -->
        <div v-else-if="panel === 'wait'" class="callout info" style="margin-bottom:0">
          团队将在厅外等候 <strong>{{ row.waitMin }} 分钟</strong>，预计 <strong>{{ reopenEnterHM(incident) }}</strong> 恢复进场，后续站点联动顺延。
          <div style="margin-top:8px">
            <button class="btn-sm btn-gold" @click="decide({ decision: 'wait_reopen' })">确认等待恢复并顺延</button>
          </div>
        </div>

        <!-- 拒绝替代方案 -->
        <div v-else>
          <div class="pill-row" style="gap:6px; margin-bottom:10px">
            <button class="btn-sm" :style="rejectTab === 'refund' ? 'border-color:var(--gold); color:var(--gold)' : ''" @click="rejectTab = 'refund'">💰 部分退款</button>
            <button class="btn-sm" :style="rejectTab === 'reschedule' ? 'border-color:var(--gold); color:var(--gold)' : ''" @click="rejectTab = 'reschedule'">📅 改期</button>
            <button class="btn-sm" :style="rejectTab === 'complaint' ? 'border-color:var(--gold); color:var(--gold)' : ''" @click="rejectTab = 'complaint'">❗ 投诉登记</button>
          </div>

          <div v-if="rejectTab === 'refund'" class="callout warn" style="margin-bottom:0">
            <div class="small">
              建议退款 <strong>¥{{ row.refund.amount.toLocaleString() }}</strong>
              ＝ ¥{{ row.refund.unitPrice }}/人 × {{ row.refund.size }} 人 × {{ Math.round(row.refund.ratio * 100) }}%
              （闭展损失 {{ row.refund.missedMin }} 分钟讲解，占比封顶 50%）
            </div>
            <div style="display:flex; gap:10px; align-items:flex-end; margin-top:8px">
              <div class="field" style="margin:0; width:160px"><label>实退金额（元）</label><input v-model.number="refundAmt" type="number" min="1" /></div>
              <button class="btn-sm btn-gold" :disabled="!refundAmt || refundAmt <= 0" @click="decide({ decision: 'refund', amount: refundAmt })">
                办理部分退款，闭展站点终止参观
              </button>
            </div>
          </div>

          <div v-else-if="rejectTab === 'reschedule'" class="callout warn" style="margin-bottom:0">
            <div class="small">原预约将取消，按原团体信息生成新日期预约（待确认台重新确认）。</div>
            <div style="display:flex; gap:10px; align-items:flex-end; margin-top:8px">
              <div class="field" style="margin:0"><label>改期到馆时间</label><input v-model="rescheduleISO" type="datetime-local" /></div>
              <button class="btn-sm btn-gold" :disabled="!rescheduleISO" @click="decide({ decision: 'reschedule', newArriveISO: rescheduleISO })">
                办理改期并生成新预约
              </button>
            </div>
          </div>

          <div v-else class="callout danger" style="margin-bottom:0">
            <div class="field" style="margin-bottom:8px">
              <label>投诉内容</label>
              <textarea v-model="complaintText" placeholder="如：闭展未提前通知，白跑一趟，要求给出说明"></textarea>
            </div>
            <button class="btn-sm btn-danger" :disabled="!complaintText.trim()" @click="decide({ decision: 'complaint', text: complaintText.trim() })">
              登记投诉，闭展站点终止参观
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 已处置记录 -->
    <template v-if="doneRecords.length">
      <hr class="divider" />
      <div class="stat-label" style="margin-bottom:6px">已处置记录</div>
      <table class="data">
        <thead><tr><th>团队</th><th>决策</th><th>详情</th><th>经办</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-for="rec in doneRecords" :key="rec.id">
            <td class="small"><strong>{{ store.byId(rec.resId)?.orgName ?? rec.resId }}</strong></td>
            <td><span class="tag tag-warn">{{ DIVERSION_DECISION_LABEL[rec.decision!] }}</span></td>
            <td class="small">{{ decisionDetail(rec) }}</td>
            <td class="small">{{ rec.handledBy }}</td>
            <td class="small mono">{{ rec.handledAt?.slice(11, 16) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>

  <!-- 运营复盘 -->
  <div class="card">
    <div class="card-title">
      运营复盘 · 闭展原因与影响
      <span class="aside">闭展影响结束后统计被改线团队的投诉率与满意度，决定是否给展厅增加预警说明</span>
    </div>
    <div v-if="!reviewRows.length" class="empty small">暂无闭展事件。</div>
    <div v-for="row in reviewRows" :key="row.inc.id"
         class="tight" style="border:1px solid var(--line); border-radius:9px; padding:12px 14px; margin-bottom:10px">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
        <strong>{{ museum.hallById(row.inc.hallId)?.name }}</strong>
        <span class="tag tag-maint">{{ CLOSURE_CATEGORY_LABEL[row.inc.category] }}</span>
        <span class="small muted">{{ row.inc.start }}-{{ row.inc.end }} · {{ row.inc.reason }}</span>
        <span v-if="row.inc.status === 'active'" class="tag tag-warn">闭展中</span>
        <span v-else class="tag tag-ok">已恢复</span>
      </div>

      <div class="grid grid-4" style="gap:10px; margin:10px 0">
        <div><div class="stat-label">受影响 / 被改线团队</div>
          <div class="stat-num" style="font-size:20px">{{ row.stats.affected }} / {{ row.stats.rerouted }}</div></div>
        <div><div class="stat-label">被改线团队投诉率</div>
          <div class="stat-num" style="font-size:20px" :style="row.stats.complaintRate >= 0.3 ? 'color:var(--red)' : ''">
            {{ row.stats.rerouted ? Math.round(row.stats.complaintRate * 100) + '%' : '—' }}</div>
          <div class="small muted">投诉 {{ row.stats.complaints }} 起</div></div>
        <div><div class="stat-label">被改线团队满意度</div>
          <div class="stat-num stars" style="font-size:20px">{{ row.stats.avgSatisfaction?.toFixed(1) ?? '—' }}</div></div>
        <div><div class="stat-label">部分退款合计</div>
          <div class="stat-num money" style="font-size:20px">¥{{ row.stats.refundSum.toLocaleString() }}</div></div>
      </div>

      <div v-if="row.inc.status === 'resolved'">
        <div v-if="row.stats.rerouted && (row.stats.complaintRate >= 0.3 || (row.stats.avgSatisfaction ?? 5) < 3.5) && !museum.hallWarnings[row.inc.hallId]"
             class="callout warn" style="margin-bottom:10px">
          ◐ 被改线团队投诉率 {{ Math.round(row.stats.complaintRate * 100) }}%、满意度 {{ row.stats.avgSatisfaction?.toFixed(1) ?? '—' }} 偏低，建议为该展厅增加预警说明，提醒后续团队。
        </div>
        <div class="grid grid-2" style="gap:10px; align-items:start">
          <div class="field" style="margin:0">
            <label>复盘结论（闭展原因进入运营复盘）</label>
            <textarea v-model="reviewDraft[row.inc.id]" placeholder="故障根因、处置时效、通知是否到位、改进措施……"></textarea>
            <div style="margin-top:6px">
              <button class="btn-sm btn-gold" @click="saveReview(row.inc.id)">保存复盘结论</button>
              <span v-if="row.inc.reviewedAt" class="hint" style="margin-left:8px">{{ row.inc.reviewedBy }} 更新于 {{ row.inc.reviewedAt.slice(11, 16) }}</span>
            </div>
          </div>
          <div class="field" style="margin:0">
            <label>展厅预警说明（展示在预约/确认/调度页面）</label>
            <textarea v-model="warningDraft[row.inc.id]" placeholder="如：本厅恒温机组老旧，暑期高峰可能临时限流，请预留备选展厅"></textarea>
            <div style="margin-top:6px; display:flex; gap:6px; align-items:center">
              <button class="btn-sm btn-gold" @click="saveWarning(row.inc.hallId, row.inc.id)">
                {{ museum.hallWarnings[row.inc.hallId] ? '更新预警说明' : '增加预警说明' }}
              </button>
              <button v-if="museum.hallWarnings[row.inc.hallId]" class="btn-sm" @click="clearWarning(row.inc.hallId, row.inc.id)">清除</button>
              <span v-if="museum.hallWarnings[row.inc.hallId]" class="tag tag-warn">⚠ 预警展示中</span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="hint">闭展影响结束后（恢复开放）可填写复盘结论并决定是否增加展厅预警说明。</div>
    </div>
  </div>
</template>
