<script setup lang="ts">
import type { TimelineEvent } from '@/types'

defineProps<{ events: TimelineEvent[] }>()

const DANGER = new Set(['complaint', 'hall_congestion', 'device_broken', 'child_lost', 'maintenance', 'late', 'reject', 'closure_incident', 'partial_refund'])
const OK = new Set(['complete', 'confirm', 'arrive', 'start_tour', 'batch_admit', 'closure_guide_read', 'closure_update'])
</script>

<template>
  <ul class="timeline">
    <li v-for="e in [...events].sort((a, b) => a.at.localeCompare(b.at))" :key="e.id"
        :class="{ danger: DANGER.has(e.kind), ok: OK.has(e.kind) }">
      <div class="t-time">{{ e.at.slice(11, 16) }} · {{ e.by }}</div>
      <div class="t-title">{{ e.title }}</div>
      <div v-if="e.detail" class="t-meta">{{ e.detail }}</div>
      <div v-if="e.amount" class="t-meta t-amount">¥{{ e.amount.toLocaleString() }}</div>
    </li>
  </ul>
</template>
