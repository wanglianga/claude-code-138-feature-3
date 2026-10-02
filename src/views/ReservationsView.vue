<script setup lang="ts">
import { computed, ref } from 'vue'
import { useReservationsStore } from '@/stores/reservations'
import { useMuseumStore } from '@/stores/museum'
import { STATUS_LABEL, type ReservationStatus } from '@/types'
import StatusBadge from '@/components/StatusBadge.vue'
import RouteChain from '@/components/RouteChain.vue'

const store = useReservationsStore()
const museum = useMuseumStore()

const filter = ref<ReservationStatus | 'all'>('all')
const keyword = ref('')
const expanded = ref<string | null>(null)

const list = computed(() =>
  [...store.list]
    .filter((r) => (filter.value === 'all' ? true : r.status === filter.value))
    .filter((r) =>
      keyword.value.trim()
        ? r.orgName.includes(keyword.value.trim()) ||
          r.contactName.includes(keyword.value.trim()) ||
          r.id.toLowerCase().includes(keyword.value.trim().toLowerCase())
        : true,
    )
    .sort((a, b) => b.arriveTime.localeCompare(a.arriveTime)),
)

const counts = computed(() => {
  const c: Record<string, number> = { all: store.list.length }
  for (const r of store.list) c[r.status] = (c[r.status] ?? 0) + 1
  return c
})

const FILTERS: (ReservationStatus | 'all')[] = [
  'all', 'submitted', 'confirmed', 'arrived', 'touring', 'completed', 'rescheduled', 'rejected', 'cancelled',
]
</script>

<template>
  <div class="toolbar">
    <button
      v-for="f in FILTERS" :key="f"
      class="btn-sm"
      :style="filter === f ? 'background:var(--ink);color:#f5f1e6;border-color:var(--ink)' : ''"
      @click="filter = f"
    >
      {{ f === 'all' ? '全部' : STATUS_LABEL[f] }} {{ counts[f] ? `(${counts[f]})` : '' }}
    </button>
    <span style="flex:1"></span>
    <input v-model="keyword" placeholder="搜索单位 / 联系人 / 编号" style="width:230px" />
    <RouterLink class="btn-sm btn-gold" to="/book">＋ 新建预约</RouterLink>
  </div>

  <div class="card" style="padding: 4px 0">
    <table class="data">
      <thead>
        <tr>
          <th>编号 / 单位</th><th>类型</th><th>到馆</th><th>人数</th><th>主题 / 语言</th>
          <th>讲解员</th><th>批次 · 通道</th><th>状态</th><th></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="r in list" :key="r.id">
          <tr class="clickable" @click="expanded = expanded === r.id ? null : r.id">
            <td>
              <strong>{{ r.orgName }}</strong>
              <div class="muted small mono">{{ r.id }}</div>
            </td>
            <td class="small">
              {{ { school: '学校', enterprise: '企业', travel: '旅行社' }[r.orgType] }}
              <div class="muted">{{ { children: '儿童', youth: '青少年', adult: '成人', senior: '银发', mixed: '混合' }[r.ageBand] }}</div>
            </td>
            <td class="mono small">
              约 {{ r.arriveTime.slice(11, 16) }}
              <div v-if="r.actualArrive" class="tag tag-ok" style="margin-top:2px">实际 {{ r.actualArrive.slice(11, 16) }}</div>
            </td>
            <td class="mono">{{ r.verifiedSize ?? r.groupSize }}<span class="muted">/{{ r.groupSize }}</span></td>
            <td class="small">{{ museum.themeById(r.themeId)?.name }}<div class="muted">{{ { zh: '中文', en: '英语', ja: '日语' }[r.language] }}{{ r.accessible ? ' · ♿' : '' }}</div></td>
            <td class="small">{{ r.assignedGuideIds.map((g) => museum.guideById(g)?.name).join('、') || '—' }}</td>
            <td class="small">{{ r.batchNo || '—' }}<div class="muted">{{ museum.lanes.find((l) => l.id === r.securityLane)?.name ?? '—' }}</div></td>
            <td><StatusBadge :status="r.status" /></td>
            <td class="small" style="white-space:nowrap">
              <RouterLink v-if="r.status === 'submitted'" class="btn-sm btn-gold" :to="`/confirm/${r.id}`">确认</RouterLink>
              <RouterLink v-if="r.status === 'confirmed'" class="btn-sm" :to="`/front/${r.id}`">到馆办理</RouterLink>
              <RouterLink v-if="r.status === 'touring'" class="btn-sm" :to="`/dispatch`">调度</RouterLink>
              <RouterLink v-if="r.status === 'touring'" class="btn-sm" :to="`/checkout/${r.id}`">离馆</RouterLink>
              <RouterLink class="btn-sm btn-ghost" :to="`/trace/${r.id}`">追溯</RouterLink>
            </td>
          </tr>
          <tr v-if="expanded === r.id">
            <td colspan="9" style="background: var(--paper); padding: 16px">
              <div class="grid grid-2">
                <div>
                  <div class="small muted" style="margin-bottom:8px">参观路线（计划 / 实际）</div>
                  <RouteChain :reservation="r" compact />
                  <div class="divider" />
                  <dl class="kv">
                    <dt>联系人</dt><dd>{{ r.contactName }} {{ r.contactPhone }}</dd>
                    <dt>车辆</dt><dd>{{ r.busInfo }}</dd>
                    <dt>耳麦</dt><dd>{{ r.needHeadsets ? `借用 ${r.headsetCount} 台，押金 ¥${r.depositTotal.toLocaleString()}` : '不借用' }}</dd>
                    <dt>讲解时长</dt><dd>{{ r.durationMin }} 分钟</dd>
                    <dt v-if="r.confirmNote">确认备注</dt><dd v-if="r.confirmNote">{{ r.confirmNote }}</dd>
                    <dt v-if="r.complaint">投诉</dt><dd v-if="r.complaint" style="color:var(--red)">{{ r.complaint }}</dd>
                  </dl>
                </div>
                <div style="max-height:300px; overflow:auto">
                  <div class="small muted" style="margin-bottom:8px">操作记录（{{ r.timeline.length }}）</div>
                  <div v-for="e in [...r.timeline].reverse().slice(0, 8)" :key="e.id" class="small" style="padding:5px 0; border-bottom:1px dashed var(--line)">
                    <span class="mono muted">{{ e.at.slice(11, 16) }}</span>
                    {{ e.title }}
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <div v-if="!list.length" class="empty">没有符合条件的预约</div>
  </div>
</template>
