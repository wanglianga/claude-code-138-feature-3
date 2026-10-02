<script setup lang="ts">
import { computed } from 'vue'
import { useMuseumStore } from '@/stores/museum'
import { useReservationsStore } from '@/stores/reservations'
import { useClosuresStore } from '@/stores/closures'
import { guideBusyWindows, hallLoadAt, occupancyGrid } from '@/lib/schedule'
import { hmOfISO, toMin } from '@/lib/time'
import CapacityBar from '@/components/CapacityBar.vue'
import HallTags from '@/components/HallTags.vue'
import StatusBadge from '@/components/StatusBadge.vue'

const museum = useMuseumStore()
const store = useReservationsStore()
const closures = useClosuresStore()

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
</script>

<template>
  <!-- 临时闭展横幅 -->
  <div v-if="closures.active.length" class="callout danger" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap">
    <strong>🚨 临时闭展 {{ closures.active.length }} 起：</strong>
    <span v-for="inc in closures.active" :key="inc.id" class="small">
      「{{ museum.hallById(inc.hallId)?.name }}」{{ inc.reason }}（{{ inc.start }}-{{ inc.end }}）
    </span>
    <RouterLink to="/closure" class="btn-sm btn-gold" style="margin-left:auto">前往闭展分流中心处置 ▸</RouterLink>
  </div>

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
</template>
