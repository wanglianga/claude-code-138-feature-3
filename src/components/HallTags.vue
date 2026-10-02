<script setup lang="ts">
import { computed } from 'vue'
import type { Hall } from '@/types'
import { useMuseumStore } from '@/stores/museum'
import { closureAt } from '@/lib/schedule'

const props = defineProps<{ hall: Hall; ratio?: number; showAll?: boolean }>()
const museum = useMuseumStore()

const closure = computed(() => closureAt(props.hall, museum.nowHM, museum.maintenance))
const noPhoto = computed(() => props.hall.exhibits.some((e) => e.noPhoto))
const hot = computed(() => props.hall.exhibits.some((e) => e.hot))
const warning = computed(() => museum.hallWarnings[props.hall.id])
</script>

<template>
  <span class="pill-row" style="display:inline-flex">
    <span v-if="closure" class="tag tag-maint">🛠 {{ closure.reason }} {{ closure.start }}-{{ closure.end }}</span>
    <span v-if="warning" class="tag tag-warn" :title="warning">⚠ 预警：{{ warning }}</span>
    <span v-if="hall.childFriendly" class="tag tag-kid">🧒 儿童友好</span>
    <span v-if="!hall.accessible" class="tag tag-acc">⚠ 无无障碍通道</span>
    <span v-else class="tag tag-acc">♿ 无障碍可达</span>
    <span v-if="hall.quiet === 3" class="tag tag-quiet">🤫 需保持安静</span>
    <span v-if="noPhoto" class="tag tag-photo">📷 禁止拍照</span>
    <span v-if="hot && showAll" class="tag tag-hot">🔥 热门展品</span>
    <span v-if="ratio !== undefined && ratio >= 0.85" class="tag tag-warn">⚠ 接近限流</span>
  </span>
</template>
