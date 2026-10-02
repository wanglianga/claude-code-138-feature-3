<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMuseumStore } from '@/stores/museum'
import { useReservationsStore } from '@/stores/reservations'
import { useClosuresStore } from '@/stores/closures'
import { talkingPoints } from '@/lib/closure'
import { hmOfISO } from '@/lib/time'
import { DIVERSION_DECISION_LABEL, type DiversionRecord, type Reservation } from '@/types'
import StatusBadge from '@/components/StatusBadge.vue'
import RouteChain from '@/components/RouteChain.vue'
import HallTags from '@/components/HallTags.vue'

const museum = useMuseumStore()
const store = useReservationsStore()
const closures = useClosuresStore()

const guideId = ref(museum.guides[0]?.id ?? '')
const guide = computed(() => museum.guideById(guideId.value))

/** 该讲解员今日带团（已确认/已到馆/参观中） */
const teams = computed(() =>
  store.list
    .filter(
      (r) =>
        r.assignedGuideIds.includes(guideId.value) &&
        ['confirmed', 'arrived', 'touring'].includes(r.status),
    )
    .sort((a, b) => a.arriveTime.localeCompare(b.arriveTime)),
)

/** 团队待知晓的闭展分流更新 */
function updatesFor(resId: string): DiversionRecord[] {
  return closures.pendingGuideAck(resId)
}

function updateDetail(rec: DiversionRecord): string {
  const inc = closures.incidentById(rec.incidentId)
  const hall = museum.hallById(inc?.hallId ?? '')
  switch (rec.decision) {
    case 'accept_alt':
      return `「${hall?.name}」临时闭展，团队已接受替代路线，新站点为「${museum.hallById(rec.altHallId ?? '')?.name}」，请按下方新讲解重点准备。`
    case 'theme_switch':
      return `「${hall?.name}」临时闭展，讲解主题已切换为「${museum.themeById(rec.altThemeId ?? '')?.name}」，未完成站点已按新主题重排。`
    case 'wait_reopen':
      return `「${hall?.name}」临时闭展，团队选择等待恢复（约 ${rec.waitMin} 分钟），站点已顺延，注意安抚与节奏。`
    case 'refund':
      return `「${hall?.name}」临时闭展，团队拒绝替代路线并已办理部分退款 ¥${rec.refundAmount}，该厅不再参观。`
    case 'complaint':
      return `「${hall?.name}」临时闭展，团队已登记投诉，请配合现场安抚与说明。`
    default:
      return ''
  }
}

/** 替代展厅的新讲解重点（接受替代路线时在横幅中直接给出） */
function newFocusPoints(rec: DiversionRecord, r: Reservation): string[] {
  if (rec.decision !== 'accept_alt' || !rec.altHallId) return []
  const hall = museum.hallById(rec.altHallId)
  return hall ? talkingPoints(hall, r) : []
}

function ack(rec: DiversionRecord) {
  if (!guide.value) return
  closures.ackByGuide(rec.incidentId, rec.resId, guide.value.name)
}

/** 接下来要讲站点（当前/待参观） */
function upcomingStops(r: Reservation) {
  return r.route.filter((s) => s.state === 'current' || s.state === 'planned')
}
</script>

<template>
  <!-- 讲解员选择 -->
  <div class="card" style="margin-bottom:14px">
    <div class="card-title">
      🎤 讲解员端 · 讲解重点同步
      <span class="aside">闭展分流、换主题后的新讲解重点实时同步到本页</span>
    </div>
    <div class="pill-row" style="gap:8px">
      <button v-for="g in museum.guides" :key="g.id" class="btn-sm"
              :style="g.id === guideId ? 'border-color:var(--gold); color:var(--gold); background:var(--gold-soft); background:rgba(201,178,128,.12)' : ''"
              @click="guideId = g.id">
        {{ g.name }} · {{ g.langs.map((l) => ({ zh: '中', en: '英', ja: '日' }[l])).join('/') }}
      </button>
    </div>
    <div v-if="guide" class="small muted" style="margin-top:8px">
      {{ guide.name }} · 好评 {{ guide.rating }} · 擅长主题：{{ guide.themes.map((t) => museum.themeById(t)?.name).join('、') }}
      · 当班 {{ guide.shifts.map((s) => `${s.start}-${s.end}`).join('、') }} · {{ guide.phone }}
    </div>
  </div>

  <div v-if="!teams.length" class="card empty">该讲解员今日暂无带团任务。</div>

  <div v-for="t in teams" :key="t.id" class="card" style="margin-bottom:14px">
    <div class="card-title">
      <span>{{ t.orgName }} · {{ t.verifiedSize ?? t.groupSize }} 人</span>
      <span class="aside">
        <StatusBadge :status="t.status" />
        · 到馆 {{ hmOfISO(t.arriveTime) }} · {{ museum.themeById(t.themeId)?.name }}
      </span>
    </div>

    <!-- 闭展分流更新（待知晓） -->
    <div v-for="rec in updatesFor(t.id)" :key="rec.id" class="callout warn">
      <strong>🔔 闭展分流更新（{{ DIVERSION_DECISION_LABEL[rec.decision!] }}）：</strong>{{ updateDetail(rec) }}
      <ul v-if="newFocusPoints(rec, t).length" style="margin:6px 0 0; padding-left:18px">
        <li v-for="(p, i) in newFocusPoints(rec, t)" :key="i" class="small">{{ p }}</li>
      </ul>
      <div style="margin-top:8px">
        <button class="btn-sm btn-gold" @click="ack(rec)">✓ 已知晓，更新讲稿</button>
      </div>
    </div>

    <RouteChain :reservation="t" />

    <!-- 接下来各站讲解重点 -->
    <div class="grid grid-3" style="gap:10px; margin-top:12px">
      <div v-for="(s, i) in upcomingStops(t)" :key="i" class="tight"
           style="border:1px solid var(--line); border-radius:9px; padding:10px 12px">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <strong style="font-size:13px">{{ museum.hallById(s.hallId)?.name }}</strong>
          <span class="tag" :class="s.state === 'current' ? 'tag-warn' : ''">{{ s.state === 'current' ? '讲解中' : `${s.plannedEnter} 进场` }}</span>
        </div>
        <div style="margin:6px 0"><HallTags :hall="museum.hallById(s.hallId)!" /></div>
        <ul style="margin:6px 0 0; padding-left:16px">
          <li v-for="(p, j) in talkingPoints(museum.hallById(s.hallId)!, t)" :key="j" class="small">{{ p }}</li>
        </ul>
      </div>
    </div>
    <div v-if="!upcomingStops(t).length" class="empty small">该团路线已全部完成。</div>
  </div>
</template>
