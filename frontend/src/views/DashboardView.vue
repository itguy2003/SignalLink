<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { formatBytes, formatPercent } from '@/utils/bytes'

const auth = useAuthStore()
const { t } = useI18n()

const devices = ref([])
const schedules = ref([])
const pending = ref(0)
const loading = ref(true)

onMounted(async () => {
  try {
    const [devicePage, schedulePage] = await Promise.all([
      api.get('/devices', { size: 200 }),
      api.get('/schedules', { size: 200 }),
    ])
    devices.value = devicePage.items
    schedules.value = schedulePage.items

    if (auth.can.approveUsers) {
      pending.value = (await api.get('/users/pending-count')).count
    }
  } finally {
    loading.value = false
  }
})

const online = computed(() => devices.value.filter((d) => d.online).length)
// 스케줄이 하나도 안 걸린 장치. 배정이 N:M 이 되면서 개수로 판단한다.
const unassigned = computed(() => devices.value.filter((d) => activeCount(d) === 0).length)

/**
 * 지금 실제로 나가는 스케줄 수.
 *
 * 걸려 있어도 사용 기간 밖이면 데모가 나간다. '배정됨' 이 아니라 '지금
 * 나가는가' 로 세야 대시보드가 실제 화면과 맞는다.
 */
function activeCount(device) {
  return (device.schedules ?? []).filter((s) => s.active).length
}

/**
 * 확인이 필요한 장치와 그 이유.
 *
 * 한 장치가 여러 이유로 걸릴 수 있으므로(스케줄 미배정 + 저장공간 부족)
 * 장치별로 이유를 모아 둔다. 이름만 나열하면 무엇을 해야 하는지 모른다.
 *
 * 저장공간 임계 판정은 서버가 한다(`storage_warning`). 화면에서 다시 재면
 * 기준이 갈라져 CMS 와 알림이 서로 다른 시점에 경고하게 된다.
 */
const attention = computed(() =>
  devices.value
    .map((device) => {
      const reasons = []
      if (activeCount(device) === 0) reasons.push(t('dashboard.demoReason'))
      if (device.storage_warning) {
        reasons.push(
          t('dashboard.storageWarnReason', { percent: formatPercent(device.storage_usage) }),
        )
      }
      return { device, reasons }
    })
    .filter((row) => row.reasons.length),
)

/**
 * 값이 있는 것만 가운뎃점으로 잇는다.
 *
 * CPU·메모리·저장장치·해상도·앱 버전은 전부 비어 있을 수 있는 값이라,
 * 그대로 이으면 '· ·' 같은 빈 칸이 남는다.
 */
function joinParts(parts) {
  return parts.filter(Boolean).join(' · ')
}

/** 화면 계열 정보: 운영체제 · 해상도 · 방향. */
function displaySpec(device) {
  const resolution = device.width && device.height ? `${device.width}×${device.height}` : null
  return joinParts([
    t(`enums.os.${device.os}`),
    resolution,
    t(`enums.panelType.${device.panel_type}`),
  ])
}

/**
 * 저장공간 표시.
 *
 * 장치가 보고한 실제 용량이 있으면 그것을 쓰고, 없으면 등록 시 적어 넣은
 * 사양 문자열로 물러난다. 둘은 다른 값이다 — 사양은 사람이 적은 것이고
 * 사용률은 실측에서만 나온다.
 */
function storageLabel(device) {
  const total = formatBytes(device.storage_total_bytes)
  if (total === null) return device.storage || null

  const used = formatBytes(device.storage_used_bytes)
  const percent = formatPercent(device.storage_usage)
  if (used === null || percent === null) return total
  return t('dashboard.storageUsage', { used, total, percent })
}

/** 하드웨어 계열 정보: CPU · 메모리 · 저장장치 · 앱 버전. */
function hardwareSpec(device) {
  return joinParts([
    device.cpu,
    device.memory,
    storageLabel(device),
    device.app_version ? t('dashboard.appVersion', { version: device.app_version }) : null,
  ])
}

/**
 * 마우스를 올렸을 때 보여 줄 전체 사양.
 *
 * 표에서는 줄여 보여 주므로, 어떤 값이 어느 항목인지 확인할 수단이 필요하다.
 */
function specTooltip(device) {
  const rows = [
    [t('device.os'), t(`enums.os.${device.os}`)],
    [t('device.orientation'), t(`enums.panelType.${device.panel_type}`)],
    [
      t('device.resolution'),
      device.width && device.height ? `${device.width}×${device.height}` : null,
    ],
    [t('device.cpu'), device.cpu],
    [t('device.memory'), device.memory],
    [t('device.storage'), device.storage],
    [t('device.appVersion'), device.app_version],
  ]
  return rows
    .map(([label, value]) => `${label}: ${value || t('dashboard.specUnknown')}`)
    .join('\n')
}

function formatSeen(value) {
  if (!value) return t('dashboard.lastSeen.never')
  const diffMin = Math.round((Date.now() - new Date(value).getTime()) / 60000)
  if (diffMin < 1) return t('dashboard.lastSeen.justNow')
  if (diffMin < 60) return t('dashboard.lastSeen.minutes', { count: diffMin })
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return t('dashboard.lastSeen.hours', { count: diffHour })
  return t('dashboard.lastSeen.days', { count: Math.round(diffHour / 24) })
}
</script>

<template>
  <div>
    <h1 class="page-title">{{ t('dashboard.title') }}</h1>
    <p class="page-desc">{{ t('dashboard.desc', { org: auth.user?.org_name ?? '' }) }}</p>

    <div class="stats">
      <div class="stat card">
        <div class="stat-label">{{ t('dashboard.registeredDevices') }}</div>
        <div class="stat-value">{{ devices.length }}</div>
      </div>
      <div class="stat card">
        <div class="stat-label">{{ t('dashboard.online') }}</div>
        <div class="stat-value ok">{{ online }}</div>
        <div class="stat-sub">{{ t('dashboard.offlineCount', { count: devices.length - online }) }}</div>
      </div>
      <div class="stat card">
        <div class="stat-label">{{ t('dashboard.unassigned') }}</div>
        <div class="stat-value" :class="{ warn: unassigned > 0 }">{{ unassigned }}</div>
        <div class="stat-sub">{{ t('dashboard.showingDemo') }}</div>
      </div>
      <div class="stat card">
        <div class="stat-label">{{ t('dashboard.registeredSchedules') }}</div>
        <div class="stat-value">{{ schedules.length }}</div>
      </div>
      <div v-if="auth.can.approveUsers" class="stat card">
        <div class="stat-label">{{ t('dashboard.pendingApproval') }}</div>
        <div class="stat-value" :class="{ warn: pending > 0 }">{{ pending }}</div>
        <div class="stat-sub">
          <RouterLink v-if="pending > 0" to="/users">{{ t('dashboard.goApprove') }}</RouterLink>
          <span v-else>{{ t('dashboard.noPending') }}</span>
        </div>
      </div>
    </div>

    <div class="panels">
      <section class="card">
        <div class="card-header">
          <h2>{{ t('dashboard.deviceStatus') }}</h2>
          <RouterLink to="/devices" class="btn btn-sm">{{ t('dashboard.viewAll') }}</RouterLink>
        </div>
        <table class="table">
          <thead>
            <tr>
              <!-- 고유번호는 장치명 아래로 넣었다. 시스템 정보가 들어갈 자리를 만들면서
                   한 줄에 담기는 열 수를 그대로 유지하기 위해서다. -->
              <th>{{ t('device.name') }}</th>
              <th>{{ t('dashboard.systemInfo') }}</th>
              <th>{{ t('device.schedule') }}</th>
              <th>{{ t('user.status') }}</th>
              <th>{{ t('dashboard.lastConnected') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="device in devices.slice(0, 8)" :key="device.id">
              <td>
                <div>{{ device.name }}</div>
                <div class="mono muted sub">{{ device.device_code }}</div>
              </td>
              <td class="spec" :title="specTooltip(device)">
                <div>{{ displaySpec(device) }}</div>
                <div class="sub">
                  <span class="muted">{{ hardwareSpec(device) || t('dashboard.specUnknown') }}</span>
                  <!-- 판정은 서버가 한다. 여기서는 결과만 보여 준다. -->
                  <span v-if="device.storage_warning" class="badge badge-warning storage-warn">
                    {{ t('dashboard.storageWarn', { percent: formatPercent(device.storage_usage) }) }}
                  </span>
                </div>
              </td>
              <td>
                <span v-if="activeCount(device)">
                  {{ (device.schedules ?? []).filter((s) => s.active).map((s) => s.name).join(', ') }}
                </span>
                <span v-else class="badge badge-warning">{{ t('dashboard.showingDemo') }}</span>
              </td>
              <td>
                <span class="badge" :class="device.online ? 'badge-success' : 'badge-muted'">
                  {{ device.online ? t('device.statusOnline') : t('device.statusOffline') }}
                </span>
              </td>
              <td class="muted">{{ formatSeen(device.last_seen_at) }}</td>
            </tr>
            <tr v-if="!loading && devices.length === 0">
              <td colspan="5" class="table-empty">{{ t('dashboard.noDevices') }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <div class="card-header">
          <h2>{{ t('dashboard.needsAttention') }}</h2>
        </div>
        <div class="card-body">
          <p v-if="attention.length === 0" class="muted">{{ t('dashboard.nothingToCheck') }}</p>
          <ul v-else class="todo">
            <li v-for="row in attention" :key="row.device.id">
              <strong>{{ row.device.name }}</strong>
              <!-- 이유를 함께 적는다. 이름만 나열하면 무엇을 해야 할지 모른다. -->
              <span class="muted"> {{ row.reasons.join(' ') }}</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}

.stat {
  padding: 15px 17px;
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted);
}

.stat-value {
  font-size: 27px;
  font-weight: 700;
  line-height: 1.3;
}

.stat-value.ok {
  color: var(--success);
}

.stat-value.warn {
  color: var(--warning);
}

.stat-sub {
  font-size: 11px;
  color: var(--text-muted);
}

.panels {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 18px;
  align-items: start;
}

@media (width <= 1100px) {
  .panels {
    grid-template-columns: 1fr;
  }
}

.card-header h2 {
  font-size: 14px;
}

/* 한 칸에 두 줄을 담는다. 둘째 줄은 보조 정보라 작게. */
.sub {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  line-height: 1.5;
}

.storage-warn {
  flex: none;
}

/* 사양은 길어질 수 있어 이 열만 늘어나게 두고, 전체는 title 로 확인한다. */
.spec {
  min-width: 200px;
  cursor: help;
}

.todo {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.9;
}
</style>
