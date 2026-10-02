<script setup lang="ts">
import { useMuseumStore } from '@/stores/museum'
import { useSessionStore } from '@/stores/session'

const museum = useMuseumStore()
const session = useSessionStore()

const nav = [
  { to: '/board', icon: '🏛', label: '运营看板' },
  { to: '/book', icon: '📝', label: '团体预约' },
  { to: '/reservations', icon: '📋', label: '全部预约' },
  { to: '/confirm', icon: '✅', label: '预约确认台' },
  { to: '/front', icon: '🏷', label: '到馆前台' },
  { to: '/dispatch', icon: '🔀', label: '途中分流调度' },
  { to: '/closure', icon: '🚨', label: '闭展分流中心' },
  { to: '/guide', icon: '🎤', label: '讲解员端' },
  { to: '/checkout', icon: '🎧', label: '离馆核销' },
  { to: '/trace', icon: '🔎', label: '投诉与追溯' },
]

function resetDemo() {
  if (confirm('将清空当前所有操作并恢复演示数据，确定吗？')) {
    localStorage.removeItem('museum-reservations')
    localStorage.removeItem('museum-world')
    localStorage.removeItem('museum-closures')
    location.reload()
  }
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        云川美术馆
        <small>GROUP VISIT DESK</small>
      </div>
      <RouterLink v-for="n in nav" :key="n.to" :to="n.to" class="nav-item">
        <span class="ico">{{ n.icon }}</span>{{ n.label }}
      </RouterLink>
      <div class="nav-spacer"></div>
      <button class="btn-sm" style="margin: 0 10px 10px" @click="resetDemo">↺ 恢复演示数据</button>
      <div class="nav-role">
        当前视角
        <select v-model="session.role">
          <option value="staff">馆方工作人员</option>
          <option value="visitor">团体联系人</option>
        </select>
        <input
          v-if="session.role === 'staff'"
          v-model="session.staffName"
          class="small"
          style="margin-top: 8px; width: 100%"
          placeholder="工作人员姓名"
        />
      </div>
    </aside>

    <main class="main">
      <div class="page-head">
        <div>
          <h1>{{ $route.meta.title }}</h1>
          <div class="sub">
            {{ new Date(museum.nowISO).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) }}
            · 团体参观全流程调度：预约 → 确认 → 到馆 → 分流 → 离馆 → 追溯
          </div>
        </div>
        <div class="card tight" style="display:flex; align-items:center; gap:10px">
          <span class="muted small">馆内时钟</span>
          <strong class="mono" style="font-size:18px; letter-spacing:0.06em">{{ museum.nowHM }}</strong>
          <input v-model="museum.nowHM" type="time" style="padding:4px 6px" title="手动调整馆内时钟" />
          <button v-if="!museum.running" class="btn-sm btn-gold" @click="museum.startSimulation()">▶ 推进</button>
          <button v-else class="btn-sm" @click="museum.pauseSimulation()">⏸ 暂停</button>
          <span class="hint">每 2 秒 +1 分钟</span>
        </div>
      </div>

      <RouterView />
    </main>
  </div>
</template>
