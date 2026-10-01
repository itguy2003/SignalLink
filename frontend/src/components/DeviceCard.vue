<script setup>
/**
 * 장치 카드.
 *
 * 표 한 줄로는 화면 캡처를 보여 줄 자리가 없어 카드로 바꿨다. 카드 가운데가
 * 그 장치가 지금 무엇을 표출하고 있는지 보여 주는 자리고, 아래가 제어 버튼이다.
 *
 * 제어 명령은 WebSocket 으로만 나가므로 **접속 중인 장치에만** 보낼 수 있다.
 * 오프라인 장치의 버튼을 눌리게 두면 눌러 본 뒤에야 실패를 알게 된다.
 */
import { useI18n } from 'vue-i18n'

import DeviceScreenThumb from '@/components/DeviceScreenThumb.vue'
import { useDeviceCommands } from '@/composables/useDeviceCommands'

const props = defineProps({
  device: { type: Object, required: true },
  schedules: { type: Array, default: () => [] },
  selected: { type: Boolean, default: false },
  /**
   * 선택 체크박스를 둘지.
   *
   * 일괄 배정 도구가 없는 자리에서 고를 수 있게 두면 골라 놓고 아무것도
   * 못 하는 상태가 된다.
   */
  selectable: { type: Boolean, default: true },
  canManage: { type: Boolean, default: false },
  canCreate: { type: Boolean, default: false },
})

const emit = defineEmits([
  'toggle',
  'edit',
  'delegate',
  'remove',
  'edit-schedules',
  'command',
  'refresh',
])

const { t, locale } = useI18n()

// 제어 버튼의 동작은 리스트 보기와 공유한다. 두 벌로 두면 보기 방식에 따라 갈린다.
const { commands, requesting, run, disabled } = useDeviceCommands(() => props.device, emit)

function formatTime(value) {
  if (!value) return null
  return new Date(value).toLocaleString(locale.value, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}
</script>

<template>
  <article class="device-card card" :class="{ offline: !device.online, picked: selected }">
    <header class="head">
      <label v-if="selectable" class="pick">
        <input type="checkbox" :checked="selected" @change="emit('toggle', device.id)" />
      </label>
      <div class="ident">
        <div class="name">
          {{ device.name }}
          <span v-if="device.is_master" class="badge badge-primary">
            {{ t('device.masterBadge') }}
          </span>
        </div>
        <div class="mono muted code">{{ device.device_code }}</div>
      </div>
      <span class="badge" :class="device.online ? 'badge-success' : 'badge-muted'">
        {{ device.online ? t('device.statusOnline') : t('device.statusOffline') }}
      </span>
    </header>

    <!-- 가운데: 지금 표출 중인 화면 -->
    <div class="screen" :class="{ portrait: device.panel_type === 'PORTRAIT' }">
      <DeviceScreenThumb :device="device" />
      <span v-if="requesting" class="screen-badge">{{ t('device.previewRequested') }}</span>
      <span v-else-if="device.screenshot_at" class="screen-badge">
        {{ formatTime(device.screenshot_at) }}
      </span>
    </div>

    <dl class="facts">
      <div>
        <dt>{{ t('device.org') }}</dt>
        <dd>{{ device.org_name ?? '-' }}</dd>
      </div>
      <div>
        <dt>{{ t('device.place') }}</dt>
        <dd>
          {{ device.place_name ?? '-' }}
          <span v-if="device.class_name" class="muted">({{ device.class_name }})</span>
        </dd>
      </div>
      <div>
        <dt>{{ t('device.spec') }}</dt>
        <dd class="muted">
          {{ t(`enums.os.${device.os}`) }} · {{ device.width }}×{{ device.height }}
          {{ t(`enums.panelType.${device.panel_type}`) }}
        </dd>
      </div>
      <div>
        <dt>{{ t('device.schedule') }}</dt>
        <dd>
          <!-- 한 장치에 여러 스케줄을 걸 수 있고 순서가 곧 우선순위다. -->
          <div class="schedule-cell">
            <p v-if="!(device.schedules ?? []).length" class="muted schedule-empty">
              {{ t('device.demoOption') }}
            </p>
            <ol v-else class="schedule-summary">
              <li v-for="(schedule, index) in device.schedules" :key="schedule.id">
                {{ index + 1 }}. {{ schedule.name }}
                <span v-if="!schedule.active" class="badge badge-muted">
                  {{ t('schedule.inactive') }}
                </span>
              </li>
            </ol>
            <button
              v-if="canManage"
              class="btn btn-sm"
              data-test="edit-schedules"
              @click="emit('edit-schedules', device)"
            >
              {{ t('device.manageSchedules') }}
            </button>
          </div>
        </dd>
      </div>
    </dl>

    <!-- 하단: 원격 제어. 접속 중인 장치에만 보낼 수 있다. -->
    <div class="controls">
      <button
        v-for="command in commands"
        :key="command.key"
        class="btn btn-sm"
        :class="{ 'btn-danger': command.danger }"
        :disabled="disabled(command, canManage)"
        :title="!device.online ? t('device.offlineHint') : null"
        @click="run(command.key)"
      >
        {{ t(command.labelKey) }}
      </button>
    </div>

    <div class="manage">
      <button class="btn btn-sm" @click="emit('edit', device)">{{ t('common.edit') }}</button>
      <button v-if="canCreate" class="btn btn-sm" @click="emit('delegate', device)">
        {{ t('device.delegate') }}
      </button>
      <button v-if="canCreate" class="btn btn-sm btn-danger" @click="emit('remove', device)">
        {{ t('common.delete') }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.device-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 오프라인은 한눈에 구분되어야 한다. 제어 버튼이 전부 잠기는 상태이기 때문이다. */
.device-card.offline {
  opacity: 0.78;
}

.device-card.picked {
  border-color: var(--primary-border);
  box-shadow: 0 0 0 2px var(--primary-soft);
}

.head {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 12px 13px 10px;
}

.pick {
  display: flex;
  align-items: center;
  padding-top: 2px;
}

.ident {
  flex: 1;
  min-width: 0;
}

.name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code {
  font-size: 11px;
}

/* 화면 비율을 유지한다. 늘어난 화면을 보여 주면 배치를 잘못 판단하게 된다. */
.screen {
  position: relative;
  margin: 0 13px;
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: #0b1120;
  overflow: hidden;
}

.screen > .screen-thumb {
  grid-area: 1 / 1;
}

.screen.portrait {
  aspect-ratio: 9 / 16;
  max-height: 320px;
  margin-inline: auto;
  width: 180px;
}

.screen-badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgb(15 23 42 / 72%);
  color: #e2e8f0;
  font-size: 10px;
}

.facts {
  margin: 0;
  padding: 11px 13px 0;
  display: grid;
  gap: 5px;
  font-size: 12px;
}

.facts > div {
  display: grid;
  grid-template-columns: 62px 1fr;
  align-items: center;
  gap: 8px;
}

.facts dt {
  color: var(--text-muted);
  font-size: 11px;
}

.facts dd {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inline-select {
  width: 100%;
  padding: 3px 6px;
  font-size: 12px;
}

.controls,
.manage {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 13px;
}

.controls {
  margin-top: auto;
  padding-bottom: 0;
}

.controls .btn {
  flex: 1;
  min-width: 60px;
}

.manage {
  border-top: 1px solid var(--border);
  margin-top: 10px;
}

.manage .btn {
  flex: 1;
}

.schedule-empty {
  margin: 0 0 4px;
  font-size: 12px;
}

.schedule-summary {
  list-style: none;
  margin: 0 0 4px;
  padding: 0;
  font-size: 12px;
  display: grid;
  gap: 2px;
}
</style>
