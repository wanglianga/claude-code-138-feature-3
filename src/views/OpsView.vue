<script setup lang="ts">
import { computed } from 'vue'
import { useMuseumStore } from '@/stores/museum'
import { useReservationsStore } from '@/stores/reservations'
import {
  closureReview,
  guideBusyWindows,
  hallLoadAt,
  occupancyGrid,
  shouldAddWarning,
} from '@/lib/schedule'
import { hmOfISO, toMin } from '@/lib/time'
import CapacityBar from '@/components/CapacityBar.vue'
import HallTags from '@/components/HallTags.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { useSessionStore } from '@/stores/session'

const museum = useMuseumStore()
const store = useReservationsStore()
const session = useSessionStore()
const grid = computed(() =>
  occupancyGrid(store.list, { maintenance: museum.maintenance, extraLoad: museum.extraLoad }),
)

const todayList = computed(() => store.list)
const inHall = computed(() =>
  todayList.value.filter((r) => ['arrived', 'touring'].includes(r.status))
    .reduce((sum, r) => sum + (r.verifiedSize ?? r.groupSize), 0),
)
const doneList = computed(() => todayList.value.filter((r) => r.status === 'completed'))
const avgSat = computed(() => {
  const v = doneList.value.map((r) => r.satisfaction).filter((x): x is number => !!x)
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—'
})
const complaints = computed(() => todayList.value.filter((r) => r.complaint))

// 展厅负载
const hallRows = computed(() =>
  museum.halls
    .map((h) => ({ hall: h, ...hallLoadAt(h, museum.nowHM, grid.value) }))
    .sort((a, b) => b.ratio - a.ratio),
)

// 讲解员小时负载（9-17 点）
const hours = Array.from({ length: 9 }, (_, i) => 9 + i)
const guideLoad = computed(() =>
  museum.guides.map((g) => {
    const wins = guideBusyWindows(store.list, g.id)
    const cells = hours.map((h) => wins.some((w) => w.start < h * 60 + 60 && w.end > h * 60))
    const onShift = hours.map((h) =>
      g.shifts.some((s) => h * 60 >= toMin(s.start) && h * 60 + 60 <= toMin(s.end)),
    )
    return { g, cells, onShift }
  }),
)

// 事件统计
const congestionEvents = computed(() =>
  todayList.value.reduce((n, r) => n + r.timeline.filter((e) => e.kind === 'hall_congestion').length, 0),
)
const rerouteEvents = computed(() =>
  todayList.value.reduce((n, r) => n + r.timeline.filter((e) => e.kind === 'reroute' || e.kind === 'maintenance').length, 0),
)
const damagedDevices = computed(() =>
  museum.headsets.filter((d) => d.status === 'damaged' || d.status === 'lost').length,
)
const largeGroups = computed(() => todayList.value.filter((r) => r.groupSize >= 35))
const overCapHalls = computed(() => hallRows.value.filter((x) => x.ratio >= 0.85))

// 优化建议
const suggestions = computed(() => {
  const out: { level: 'danger' | 'warn' | 'ok'; text: string }[] = []
  if (overCapHalls.value.length >= 2)
    out.push({ level: 'danger', text: `${overCapHalls.value.map((x) => x.hall.name.replace(/^.*? · /, '')).join('、')} 当前满载率 ≥85%：建议该时段团队栅格配额下调 20%，大团错峰 15 分钟。` })
  else if (overCapHalls.value.length === 1)
    out.push({ level: 'warn', text: `${overCapHalls.value[0].hall.name.replace(/^.*? · /, '')}接近限流：建议前台对后续同厅团队启用「先参观替代展厅」预案。` })
  if (congestionEvents.value >= 1)
    out.push({ level: 'warn', text: `今日已发生 ${congestionEvents.value} 次展厅拥堵分流，建议将该展厅的大团预约间隔从 10 分钟提高到 20 分钟。` })
  if (largeGroups.value.length / Math.max(todayList.value.length, 1) > 0.4)
    out.push({ level: 'warn', text: `大团（≥35 人）占比偏高，建议要求 35 人以上团体至少提前 3 个工作日预约并强制拆分批次。` })
  if (complaints.value.length)
    out.push({ level: 'danger', text: `今日有 ${complaints.value.length} 起投诉：热门展厅高峰时段应增配 1 名讲解员或延长单厅讲解时长，避免「讲解缩水」。` })
  if (damagedDevices.value / Math.max(museum.headsets.length, 1) > 0.03)
    out.push({ level: 'warn', text: `耳麦损坏/遗失 ${damagedDevices.value} 台，建议高峰前增加设备点检，并在儿童团发放时加套防摔绳。` })
  if (!out.length) out.push({ level: 'ok', text: '当前各展厅负载、排班与设备状态平稳，维持现有大团与限流规则。' })
  return out
})

// ---------- 临时闭展复盘 ----------
const closureRows = computed(() =>
  [...museum.incidents]
    .sort((a, b) => b.declaredAt.localeCompare(a.declaredAt))
    .map((inc) => ({ inc, review: closureReview(inc, store.list), suggest: shouldAddWarning(closureReview(inc, store.list)) })),
)
function warningOn(incidentId: string) {
  const inc = museum.incidentById(incidentId)
  return inc ? !!museum.warningByHall(inc.hallId) : false
}
function addWarning(incidentId: string) {
  const inc = museum.incidentById(incidentId)
  if (!inc) return
  const rv = closureReview(inc, store.list)
  museum.setWarning({
    hallId: inc.hallId,
    incidentId,
    setAt: museum.nowISO,
    by: session.staffName,
    text: `本厅近期因${inc.reason}临时闭展：被改线团队投诉率 ${Math.round(rv.complaintRate * 100)}%、满意度 ${rv.avgSatisfaction?.toFixed(1) ?? '—'}，预约前请注意可能的临时调整。`,
  })
}
function removeWarning(incidentId: string) {
  const inc = museum.incidentById(incidentId)
  if (inc) museum.clearWarning(inc.hallId)
}
function saveReviewNote(incidentId: string, note: string) {
  store.reviewClosure(incidentId, note)
}
</script>

<template>
  <!-- 指标卡 -->
  <div class="grid grid-4" style="margin-bottom:14px">
    <div class="card tight"><div class="stat-label">今日预约团体</div><div class="stat-num">{{ todayList.length }}</div>
      <div class="small muted">待确认 {{ store.byStatus('submitted').length }} · 在馆 {{ inHall }} 人</div></div>
    <div class="card tight"><div class="stat-label">耳麦借出 / 库存</div>
      <div class="stat-num">{{ museum.inventory.lent }}<span style="font-size:15px"> / {{ museum.headsets.length }}</span></div>
      <CapacityBar :load="museum.inventory.lent" :capacity="museum.headsets.length" compact /></div>
    <div class="card tight"><div class="stat-label">离馆团满意度均值</div><div class="stat-num stars" style="font-size:23px">{{ avgSat }}</div>
      <div class="small muted">投诉 {{ complaints.length }} 起</div></div>
    <div class="card tight"><div class="stat-label">拥堵 / 改道事件</div>
      <div class="stat-num">{{ congestionEvents }}<span style="font-size:15px"> / {{ rerouteEvents }}</span></div>
      <div class="small muted">设备损坏遗失 {{ damagedDevices }} 台</div></div>
  </div>

  <div class="grid grid-2" style="align-items:start; margin-bottom:14px">
    <!-- 展厅 -->
    <div class="card">
      <div class="card-title">展厅实时负载（{{ museum.nowHM }}）</div>
      <table class="data">
        <thead><tr><th>展厅</th><th>在场/容量</th><th>属性</th></tr></thead>
        <tbody>
          <tr v-for="row in hallRows" :key="row.hall.id">
            <td><strong style="font-size:13px">{{ row.hall.name }}</strong></td>
            <td style="min-width:170px"><CapacityBar :load="row.load" :capacity="row.hall.capacity" /></td>
            <td><HallTags :hall="row.hall" :ratio="row.ratio" /></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 排班 -->
    <div class="card">
      <div class="card-title">讲解员排班与带团占用 <span class="aside">深色=带团中 · 浅色=当班空闲 · 空=下班</span></div>
      <div style="overflow-x:auto">
        <table class="data" style="border:none">
          <thead>
            <tr>
              <th style="position:sticky; left:0; background:var(--card)">讲解员</th>
              <th v-for="h in hours" :key="h" class="mono">{{ h }}时</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in guideLoad" :key="row.g.id">
              <td style="position:sticky; left:0; background:var(--card); white-space:nowrap">
                <strong>{{ row.g.name }}</strong>
                <div class="small muted">{{ row.g.langs.map((l) => ({ zh: '中', en: '英', ja: '日' }[l])).join('/') }}</div>
              </td>
              <td v-for="(busy, i) in row.cells" :key="i" style="padding:4px; text-align:center">
                <span v-if="busy" style="display:inline-block; width:26px; height:22px; border-radius:5px; background:var(--ink); color:#f0e4c8; font-size:10px; line-height:22px">团</span>
                <span v-else-if="row.onShift[i]" style="display:inline-block; width:26px; height:22px; border-radius:5px; background:var(--gold-soft); opacity:.55"></span>
                <span v-else class="muted">·</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:8px">点击「途中分流调度」可处理讲解员临时替换；替换记录会写入团体档案，投诉时可直接回放。</div>
    </div>
  </div>

  <!-- 优化建议 + 今日团队流 -->
  <div class="grid grid-2" style="align-items:start">
    <div class="card">
      <div class="card-title">规则优化建议 <span class="aside">大团规则 · 排班 · 限流</span></div>
      <div v-for="(s, i) in suggestions" :key="i" class="callout" :class="s.level" style="margin-bottom:9px">
        <strong>{{ s.level === 'danger' ? '⚠ ' : s.level === 'warn' ? '◐ ' : '✓ ' }}</strong>{{ s.text }}
      </div>
      <hr class="divider" />
      <dl class="kv">
        <dt>大团阈值</dt><dd>≥ 35 人自动提示拆批，单批 ≤ 25 人，批间隔 ≥ 5 分钟</dd>
        <dt>限流规则</dt><dd>展厅在场人数达容量 85% 预警、100% 启动分流改道</dd>
        <dt>预约规则</dt><dd>大团与外语讲解建议提前 3 个工作日预约</dd>
        <dt>押金规则</dt><dd>耳麦 ¥{{ museum.depositPerUnit }}/台；损坏赔 ¥50、遗失赔 ¥200</dd>
      </dl>
    </div>

    <div class="card" style="padding:4px 0">
      <div class="card-title" style="margin:10px 14px 6px">今日团队入场流</div>
      <table class="data">
        <thead><tr><th>到馆</th><th>团体</th><th>人数</th><th>讲解员</th><th>批次</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="r in [...todayList].sort((a,b) => a.arriveTime.localeCompare(b.arriveTime))" :key="r.id" class="clickable">
            <td class="mono small">{{ hmOfISO(r.arriveTime) }}<div v-if="r.actualArrive" class="tag tag-ok" style="margin-top:2px">实到 {{ hmOfISO(r.actualArrive) }}</div></td>
            <td><RouterLink :to="`/trace/${r.id}`"><strong style="font-size:13px">{{ r.orgName }}</strong></RouterLink></td>
            <td class="mono">{{ r.verifiedSize ?? r.groupSize }}</td>
            <td class="small">{{ r.assignedGuideIds.map((g) => museum.guideById(g)?.name).join('、') || '—' }}</td>
            <td class="small">{{ r.batchNo ?? '—' }}</td>
            <td><StatusBadge :status="r.status" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ============ 临时闭展分流复盘 ============ -->
  <div class="card" style="margin-top:14px">
    <div class="card-title">
      临时闭展分流与运营复盘
      <span class="aside">被改线团队投诉率 · 满意度 · 退款 · 是否增加展厅预警</span>
    </div>
    <div v-if="!closureRows.length" class="empty small">当日暂无临时闭展事件。</div>
    <table v-else class="data">
      <thead>
        <tr>
          <th>闭展事件</th><th>状态 / 时段</th><th>受影响</th><th>接受改线 / 拒绝</th>
          <th>投诉率（已反馈）</th><th>满意度均值</th><th>退款合计</th><th>预警决策</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in closureRows" :key="row.inc.id">
          <td>
            <strong style="font-size:13px">{{ museum.hallById(row.inc.hallId)?.name }}</strong>
            <div class="small muted">{{ row.inc.reason }}</div>
            <div class="small muted">登记 {{ row.inc.declaredBy }}</div>
          </td>
          <td class="small">
            <span class="tag" :class="row.inc.status === 'active' ? 'tag-maint' : 'tag-ok'">
              {{ row.inc.status === 'active' ? '闭展中' : '已结束' }}
            </span>
            <div class="mono muted" style="margin-top:3px">{{ row.inc.start }}-{{ row.inc.end || '…' }}</div>
          </td>
          <td class="mono">{{ row.review.affected }} 团</td>
          <td class="small">
            <span style="color:var(--green)">{{ row.review.rerouted }} 接受</span>
            / <span style="color:var(--red)">{{ row.review.refused }} 拒绝</span>
            <div class="muted">改期 {{ row.review.rescheduled }} · 投诉单 {{ row.review.complaintRegistered }}</div>
          </td>
          <td>
            <strong :style="row.review.complaintRate >= 0.25 ? 'color:var(--red)' : 'color:var(--green)'">
              {{ Math.round(row.review.complaintRate * 100) }}%
            </strong>
            <div class="small muted">{{ row.review.feedbackCount ? `${row.review.feedbackCount} 团已离馆反馈` : '暂无离馆反馈' }}</div>
          </td>
          <td class="stars">{{ row.review.avgSatisfaction?.toFixed(1) ?? '—' }}</td>
          <td class="money">¥{{ row.review.refundTotal }}</td>
          <td class="small">
            <span v-if="row.inc.status === 'active'" class="muted">闭展结束后可决策</span>
            <template v-else>
              <span v-if="warningOn(row.inc.id)" class="tag tag-warn">⚠ 已挂预警</span>
              <strong v-else-if="row.suggest" style="color:var(--red)">建议增加预警</strong>
              <span v-else class="tag tag-ok">指标平稳，无需预警</span>
              <div style="margin-top:6px; display:flex; gap:6px">
                <button v-if="!warningOn(row.inc.id)" class="btn-sm btn-gold" :disabled="!row.suggest" @click="addWarning(row.inc.id)">增加预警说明</button>
                <button v-else class="btn-sm" @click="removeWarning(row.inc.id)">撤下预警</button>
                <RouterLink class="btn-sm" :to="`/closure`">去分流台</RouterLink>
              </div>
            </template>
          </td>
        </tr>
        <tr v-for="row in closureRows" :key="row.inc.id + '-note'">
          <td colspan="8" style="background:var(--paper); padding:10px 14px">
            <div class="small muted" style="margin-bottom:5px">运营复盘备注（闭展原因、改进措施，随事件归档）</div>
            <textarea
              :value="row.inc.reviewNote"
              style="width:100%; min-height:48px"
              placeholder="如：高峰前增加配电巡检、预约页增加临时调整提示、改线话术统一……"
              @change="saveReviewNote(row.inc.id, ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
