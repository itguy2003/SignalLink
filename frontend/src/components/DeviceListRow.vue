<script setup>
/**
 * 장치 한 줄(리스트 보기).
 *
 * 카드 보기와 **같은 정보, 같은 조작**을 담는다. 보기 방식은 밀도만 바꾸는
 * 것이지 무엇을 볼 수 있는지를 바꾸는 것이 아니다 — 리스트에서만 빠진 값이
 * 있으면 그 값을 확인하려고 매번 보기를 바꿔야 한다.
 *
 * 다른 점은 화면 캡처뿐이다. 한 줄 높이에는 그릴 자리가 없어 작은 썸네일로
 * 줄이고, 캡처 시각은 title 로 옮겼다.
 */
import { useI18n } from 'vue-i18n'

import DeviceScreenThumb from '@/components/DeviceScreenThumb.vue'
import SchedulePicker from '@/components/SchedulePicker.vue'
import { useDeviceCommands } from '@/composables/useDeviceCommands'

const props = defineProps({
  device: { type: Object, required: true },
  schedules: { type: Array, default: () => [] },
  selected: { type: Boolean, default: false },
  selectable: { type: Boolean, default: true },
  canManage: { type: Boolean, default: false },
  canCreate: { type: Boolean, default: false },
})

const emit = defineEmits([
  'toggle',
  'edit',
  'delegate',
  'remove',
  'assign',
  'command',
  'refresh',
])

const { t, locale } = useI18n()

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
  <tr class="device-row" :class="{ offline: !device.online, picked: selected }">
    <td v-if="selectable" class="narrow">
      <input type="checkbox" :checked="selected" @change="emit('toggle', device.id)" />
    </td>

    <td class="shot-cell">
      <div
        class="shot"
        :class="{ portrait: device.panel_type === 'PORTRAIT' }"
        :title="
          requesting
            ? t('device.previewRequested')
            : (formatTime(device.screenshot_at) ?? t('device.noScreenshot'))
        "
      >
        <DeviceScreenThumb :device="device">
          <template #empty><span class="shot-dash">—</span></template>
        </DeviceScreenThumb>
      </div>
    </td>

    <td>
      <div class="name">
        {{ device.name }}
        <span v-if="device.is_master" class="badge badge-primary">
          {{ t('device.masterBadge') }}
        </span>
      </div>
      <div class="mono muted sub">{{ device.device_code }}</div>
    </td>

    <td class="muted">{{ device.org_name ?? '-' }}</td>

    <td>
      {{ device.place_name ?? '-' }}
      <span v-if="device.class_name" class="muted">({{ device.class_name }})</span>
    </td>

    <td class="muted sub">
      {{ t(`enums.os.${device.os}`) }} · {{ device.width }}×{{ device.height }}
      {{ t(`enums.panelType.${device.panel_type}`) }}
    </td>

    <td>
      <!-- 카드 보기와 같은 컴포넌트다. 보기 방식이 다뤄지는 값을 바꾸면 안 된다. -->
      <SchedulePicker
        class="schedule-cell"
        :assigned="device.schedules ?? []"
        :schedules="schedules"
        :disabled="!canManage"
        @change="emit('assign', { device, scheduleIds: $event })"
      />
    </td>

    <td>
      <span class="badge" :class="device.online ? 'badge-success' : 'badge-muted'">
        {{ device.online ? t('device.statusOnline') : t('device.statusOffline') }}
      </span>
    </td>

    <td class="actions">
      <div class="row">
        <!-- 카드 보기와 같은 명령, 같은 잠금 규칙(useDeviceCommands). -->
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
        <button class="btn btn-sm" @click="emit('edit', device)">{{ t('common.edit') }}</button>
        <button v-if="canCreate" class="btn btn-sm" @click="emit('delegate', device)">
          {{ t('device.delegate') }}
        </button>
        <button v-if="canCreate" class="btn btn-sm btn-danger" @click="emit('remove', device)">
          {{ t('common.delete') }}
        </button>
      </div>
    </td>
  </tr>
</template>

<style scoped>
/* 오프라인은 한눈에 구분되어야 한다. 제어 버튼이 전부 잠기는 상태이기 때문이다. */
.device-row.offline {
  opacity: 0.78;
}

.device-row.picked {
  background: var(--primary-soft);
}

.narrow {
  width: 34px;
}

.shot-cell {
  width: 1%;
}

/* 한 줄 높이에 맞춘 축소판. 비율은 카드와 같게 유지한다. */
.shot {
  width: 72px;
  aspect-ratio: 16 / 9;
  border-radius: 4px;
  overflow: hidden;
}

.shot.portrait {
  width: 30px;
  aspect-ratio: 9 / 16;
}

.shot-dash {
  color: var(--text-muted);
  font-size: 11px;
}

.name {
  font-weight: 600;
  white-space: nowrap;
}

.sub {
  font-size: 11px;
  line-height: 1.5;
}

/* 한 줄 안에 들어가도록 폭만 제한한다. 내용은 카드와 같다. */
.schedule-cell {
  min-width: 210px;
}

.actions .row {
  flex-wrap: wrap;
  gap: 5px;
  justify-content: flex-end;
}
</style>
