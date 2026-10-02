<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useMuseumStore } from '@/stores/museum'
import { useReservationsStore } from '@/stores/reservations'
import { useSessionStore } from '@/stores/session'
import { hmOfISO, toMin } from '@/lib/time'
import StatusBadge from '@/components/StatusBadge.vue'
import RouteChain from '@/components/RouteChain.vue'
import TimelineView from '@/components/TimelineView.vue'

const store = useReservationsStore()
const museum = useMuseumStore()
const session = useSessionStore()
const route = useRoute()

const list = computed(() =>
  [...store.list].sort((a, b) => {
    const ac = a.complaint ? 0 : 1
    const bc = b.complaint ? 0 : 1
    return ac - bc || b.arriveTime.localeCompare(a.arriveTime)
  }),
)
const selectedId = ref((route.params.id as string) || list.value[0]?.id || '')
watch(list, (l) => {
  if (!l.some((x) => x.id === selectedId.value) && l[0]) selectedId.value = l[0].id
}, { immediate: true })

const r = computed(() => store.byId(selectedId.value))
const newComplaint = ref('')
const reply = ref('')
watch(selectedId, () => {
  newComplaint.value = ''
  reply.value = r.value?.complaintReply ?? ''
}, { immediate: true })

/** 实际在厅讲解时长：各站 actualLeave-actualEnter 之和（压缩停留会直接体现为"讲解缩水"） */
const actualDuration = computed(() => {
  if (!r.value) return null
  const withActual = r.value.route.filter((s) => s.actualEnter && s.actualLeave)
  if (!withActual.length) return null
  const inHall = withActual.reduce(
    (sum, s) => sum + toMin(s.actualLeave!) - toMin(s.actualEnter!),
    0,
  )
  const start = withActual[0].actualEnter!
  const end = r.value.departAt ? hmOfISO(r.value.departAt) : withActual[withActual.length - 1].actualLeave!
  return { start, end, min: inHall }
})

const guideChanges = computed(() =>
  r.value?.timeline.filter((e) => e.kind === 'guide_swap' || e.kind === 'guide_assign') ?? [],
)

/** 本团参与的临时闭展事件及处置单 */
const closurePlans = computed(() => {
  if (!r.value) return []
  return museum.incidents
    .filter((inc) => inc.plans[r.value!.id])
    .map((inc) => ({ inc, plan: inc.plans[r.value!.id] }))
})
const PLAN_STATUS_TEXT: Record<string, string> = {
  identified: '已筛出待处置',
  notified: '已通知联系人，待答复',
  rerouted: '接受替代路线',
  refunded: '拒绝替代路线 · 部分退款',
  rescheduled: '拒绝替代路线 · 已改期',
  complaint: '拒绝替代路线 · 投诉登记',
}

function submitComplaint() {
  if (!newComplaint.value.trim()) return
  store.addComplaint(selectedId.value, newComplaint.value.trim(), r.value?.contactName ?? '团体联系人')
  newComplaint.value = ''
}
function submitReply() {
  store.replyComplaint(selectedId.value, reply.value.trim(), session.staffName)
}

const deviceRows = computed(() => r.value?.devices ?? [])
</script>

<template>
  <div class="grid" style="grid-template-columns: 260px 1fr; align-items:start">
    <div class="card" style="padding:6px">
      <div class="card-title" style="margin:6px 8px">预约档案</div>
      <div v-for="x in list" :key="x.id" style="padding:9px 12px; cursor:pointer; border-radius:8px"
           :style="x.id === selectedId ? 'background:var(--paper-2)' : ''" @click="selectedId = x.id">
        <div style="display:flex; gap:6px; align-items:center">
          <strong style="font-size:13px">{{ x.orgName }}</strong>
          <span v-if="x.complaint" title="有投诉" style="color:var(--red)">❗</span>
        </div>
        <div class="small muted mono">{{ x.id }} · {{ hmOfISO(x.arriveTime) }}</div>
        <div style="margin-top:3px"><StatusBadge :status="x.status" /></div>
      </div>
    </div>

    <div v-if="r" style="display:flex; flex-direction:column; gap:14px">
      <!-- 投诉条 -->
      <div class="card" :style="r.complaint ? 'border-color:var(--red)' : ''">
        <div class="card-title">
          团体投诉与解释
          <span class="aside">证据来自同一预约的全流程留痕，不依赖人工回忆</span>
        </div>
        <div v-if="r.complaint" class="callout danger">
          <strong>团体投诉（{{ r.contactName }}）：</strong>{{ r.complaint }}
        </div>
        <div v-if="r.complaintReply" class="callout ok" style="margin-bottom:10px">
          <strong>馆方答复（{{ session.staffName }}）：</strong>{{ r.complaintReply }}
        </div>
        <div v-if="r.complaint && r.status === 'completed'" class="field">
          <label>馆方处理答复</label>
          <textarea v-model="reply" placeholder="根据下方证据链说明情况、致歉与改进措施"></textarea>
          <div><button class="btn-gold" :disabled="!reply.trim()" @click="submitReply">保存答复</button></div>
        </div>
        <div v-else-if="!r.complaint">
          <div class="field">
            <label>登记团体反馈/投诉</label>
            <textarea v-model="newComplaint" placeholder="如：讲解缩水、等待过长、设备问题……"></textarea>
          </div>
          <button class="btn-danger" :disabled="!newComplaint.trim()" @click="submitComplaint">登记投诉</button>
        </div>
      </div>

      <!-- 关键事实 -->
      <div class="grid grid-4">
        <div class="card tight">
          <div class="stat-label">预约 / 实际到馆</div>
          <div class="stat-num" style="font-size:20px">{{ hmOfISO(r.arriveTime) }}</div>
          <div class="small" :style="r.actualArrive ? '' : 'color:var(--ink-3)'">
            {{ r.actualArrive ? `实际 ${hmOfISO(r.actualArrive)}` : '尚未到馆' }}
          </div>
        </div>
        <div class="card tight">
          <div class="stat-label">预约 / 实到人数</div>
          <div class="stat-num">{{ r.groupSize }} <span style="font-size:15px">/ {{ r.verifiedSize ?? '—' }}</span></div>
          <div v-if="r.verifiedSize !== undefined && r.verifiedSize !== r.groupSize" class="small" style="color:var(--amber)">
            人数差异 {{ r.verifiedSize - r.groupSize > 0 ? `+${r.verifiedSize - r.groupSize}` : r.verifiedSize - r.groupSize }}
          </div>
        </div>
        <div class="card tight">
          <div class="stat-label">计划 / 实际讲解时长</div>
          <div class="stat-num">{{ r.durationMin }} <span style="font-size:15px">/ {{ actualDuration?.min ?? '—' }} 分钟</span></div>
          <div v-if="actualDuration && actualDuration.min < r.durationMin - 10" class="small" style="color:var(--red)">
            ⚠ 实际少 {{ r.durationMin - actualDuration.min }} 分钟
          </div>
        </div>
        <div class="card tight">
          <div class="stat-label">满意度</div>
          <div class="stars" style="font-size:22px">{{ r.satisfaction ? '★'.repeat(r.satisfaction) + '☆'.repeat(5 - r.satisfaction) : '—' }}</div>
          <div class="small muted">{{ r.departAt ? `离馆 ${hmOfISO(r.departAt)}` : '' }}</div>
        </div>
      </div>

      <!-- 临时闭展处置（设备故障分流证据） -->
      <div v-if="closurePlans.length" class="card">
        <div class="card-title">
          临时闭展分流处置
          <span class="aside">受影响筛选 · 替代路线/等待/换主题 · 通知 · 退款/改期/投诉 · 讲解重点</span>
        </div>
          <div v-for="{ inc, plan } in closurePlans" :key="inc.id" class="callout" :class="inc.status === 'active' ? 'danger' : 'ok'" style="margin-bottom:10px">
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
              <strong>{{ museum.hallById(inc.hallId)?.name }}</strong>
              <span class="tag" :class="inc.status === 'active' ? 'tag-maint' : 'tag-ok'">{{ inc.status === 'active' ? '闭展中' : '影响已结束' }}</span>
              <span class="small muted mono">{{ inc.start }}-{{ inc.end || '…' }}</span>
              <span class="tag">{{ PLAN_STATUS_TEXT[plan.status] }}</span>
            </div>
            <div class="small" style="margin-top:6px">{{ inc.reason }} · 登记人 {{ inc.declaredBy }}</div>
            <dl class="kv" style="margin-top:8px">
              <dt>预计等待</dt><dd>{{ plan.waitMin }} 分钟</dd>
              <dt>替代路线</dt>
              <dd>
                <template v-if="plan.appliedHallId">已改至 <strong>{{ museum.hallById(plan.appliedHallId)?.name }}</strong></template>
                <template v-else-if="plan.suggestedHallId">建议 → {{ museum.hallById(plan.suggestedHallId)?.name }}（团队未接受）</template>
                <template v-else>无</template>
              </dd>
              <dt>讲解主题</dt>
              <dd>
                <span v-if="plan.switchedThemeId">已切换为「{{ museum.themeById(plan.switchedThemeId)?.name }}」</span>
                <span v-else-if="plan.themeSwitchable">当时可换（{{ plan.altThemeIds.map((t) => museum.themeById(t)?.name).join('、') }}）</span>
                <span v-else>不可换</span>
              </dd>
              <dt>联系人通知</dt>
              <dd>{{ plan.notified ? `已于 ${plan.notifiedAt?.slice(11, 16)} 送达（${inc.notices.filter((n) => n.contactName === r?.contactName).length} 条记录）` : '未通知' }}</dd>
              <dt>讲解重点</dt>
              <dd>
                <template v-if="r?.briefings?.length">已同步 {{ r.assignedGuideIds.map((g) => museum.guideById(g)?.name).join('、') }}
                  ，{{ r.briefings.some((b) => b.readAt) ? '讲解员已确认' : '待讲解员确认' }}</template>
                <template v-else>—</template>
              </dd>
              <dt v-for="rf in r?.refunds?.filter((x) => x.incidentId === inc.id) ?? []" :key="rf.id">部分退款</dt>
              <dd v-for="rf in r?.refunds?.filter((x) => x.incidentId === inc.id) ?? []" :key="'v-' + rf.id" class="money">¥{{ rf.amount }}（{{ rf.ratio }}%）<span class="small muted" style="margin-left:6px">{{ rf.reason }}</span></dd>
              <dt v-if="r?.rescheduledTo">改期至</dt><dd v-if="r?.rescheduledTo">{{ r.rescheduledTo.slice(0, 16).replace('T', ' ') }}（改期待约）</dd>
            </dl>
          </div>
      </div>

      <!-- 分流决策 & 讲解员 -->
      <div class="grid grid-2" style="align-items:start">
        <div class="card">
          <div class="card-title">分流决策与展厅容量回放</div>
          <RouteChain :reservation="r" />
          <hr class="divider" />
          <table class="data">
            <thead><tr><th>展厅</th><th>计划</th><th>实际</th><th>情况说明</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in r.route" :key="i">
                <td class="small"><strong>{{ museum.hallById(s.hallId)?.name.replace(/^.*? · /, '') }}</strong></td>
                <td class="small mono">{{ s.plannedEnter }}~{{ s.plannedLeave }}</td>
                <td class="small mono">{{ s.actualEnter ?? '—' }}~{{ s.actualLeave ?? '—' }}</td>
                <td class="small">{{ s.note || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style="display:flex; flex-direction:column; gap:14px">
          <div class="card">
            <div class="card-title">讲解员派工与变更</div>
            <div v-if="!guideChanges.length" class="empty small">无记录</div>
            <div v-for="e in guideChanges" :key="e.id" style="padding:7px 0; border-bottom:1px dashed var(--line)" class="small">
              <span class="mono muted">{{ e.at.slice(11, 16) }}</span> {{ e.title }}
              <div v-if="e.detail" class="muted">{{ e.detail }}</div>
            </div>
            <div class="divider" />
            <dl class="kv">
              <dt>最终讲解员</dt>
              <dd>{{ r.assignedGuideIds.map((g) => `${museum.guideById(g)?.name}（好评 ${museum.guideById(g)?.rating}）`).join('、') || '—' }}</dd>
              <dt>入馆批次</dt><dd>{{ r?.batchNo ?? '—' }} · {{ museum.lanes.find((l) => l.id === r?.securityLane)?.name ?? '—' }}</dd>
            </dl>
          </div>

          <div class="card">
            <div class="card-title">
              设备借还与押金
              <span class="aside">借出 {{ deviceRows.length }} 台</span>
            </div>
            <div v-if="!deviceRows.length" class="empty small">未借用耳麦</div>
            <table v-else class="data">
              <thead><tr><th>编号</th><th>借出</th><th>归还</th><th>状态</th><th>扣款</th></tr></thead>
              <tbody>
                <tr v-for="d in deviceRows" :key="d.code">
                  <td class="mono small">{{ d.code }}</td>
                  <td class="small mono">{{ d.lentAt?.slice(11, 16) }}</td>
                  <td class="small mono">{{ d.returnedAt?.slice(11, 16) ?? '—' }}</td>
                  <td class="small">
                    <span class="tag" :class="{ 'tag-ok': d.status === 'returned', 'tag-maint': d.status === 'damaged' || d.status === 'lost', 'tag-warn': d.status === 'lent' }">
                      {{ { available: '在库', lent: '借出中', returned: '完好归还', damaged: '损坏', lost: '遗失' }[d.status] }}
                    </span>
                    <div v-if="d.note" class="muted">{{ d.note }}</div>
                  </td>
                  <td class="small money">{{ d.damageFee ? `¥${d.damageFee}` : '—' }}</td>
                </tr>
              </tbody>
            </table>
            <dl class="kv" style="margin-top:10px">
              <dt>押金合计</dt><dd class="money">¥{{ r.depositTotal.toLocaleString() }}</dd>
              <dt>扣款</dt><dd class="money">¥{{ r.depositDeduction }}</dd>
              <dt>实退</dt><dd class="money">¥{{ (r.depositTotal - r.depositDeduction).toLocaleString() }}</dd>
            </dl>
          </div>
        </div>
      </div>

      <!-- 完整时间线 -->
      <div class="card">
        <div class="card-title">完整操作时间线 <span class="aside">到馆 · 分流 · 讲解变更 · 容量 · 设备 · 押金，全部可查</span></div>
        <TimelineView :events="r.timeline" />
      </div>
    </div>
  </div>
</template>
