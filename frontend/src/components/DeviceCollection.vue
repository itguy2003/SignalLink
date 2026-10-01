<script setup>
/**
 * 장치 묶음을 카드 또는 리스트로 그린다.
 *
 * 장치 탭과 장치그룹 탭이 **모두 이것을 쓴다**. 장치를 그리는 곳이 하나뿐이면
 * 두 탭의 정보가 어긋날 수가 없다. 보기 방식(카드/리스트)은 밀도만 바꾸며,
 * 무엇을 볼 수 있고 무엇을 누를 수 있는지는 같다.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import DeviceCard from '@/components/DeviceCard.vue'
import DeviceListRow from '@/components/DeviceListRow.vue'

const props = defineProps({
  devices: { type: Array, required: true },
  schedules: { type: Array, default: () => [] },
  /** 'card' | 'list' */
  mode: { type: String, default: 'card' },
  selectedIds: { type: Array, default: () => [] },
  selectable: { type: Boolean, default: true },
  canManage: { type: Boolean, default: false },
  canCreate: { type: Boolean, default: false },
  /**
   * 한 번에 그릴 개수. 0 이면 받은 것을 전부 그린다.
   *
   * 서버 페이지네이션을 이미 거친 목록(장치 탭 기본 상태)은 0 으로 두고,
   * 통째로 받아 온 목록(그룹 필터, 그룹 탭)에만 쓴다. 그룹 하나에 50대가
   * 들어 있으면 카드 50장을 한꺼번에 그리게 되는데, 스크롤로 훑기에도
   * 길고 브라우저도 눈에 띄게 굼떠진다.
   */
  pageSize: { type: Number, default: 0 },
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

const { t } = useI18n()

const page = ref(1)

const pageCount = computed(() =>
  props.pageSize > 0 ? Math.max(1, Math.ceil(props.devices.length / props.pageSize)) : 1,
)

const shown = computed(() => {
  if (props.pageSize <= 0) return props.devices
  const start = (page.value - 1) * props.pageSize
  return props.devices.slice(start, start + props.pageSize)
})

// 목록이 짧아지면 있지도 않은 장에 남을 수 있다(그룹을 바꾸거나 장치를 지웠을 때).
watch(pageCount, (count) => {
  if (page.value > count) page.value = count
})

// 다른 묶음을 보기 시작하면 첫 장부터다.
watch(() => props.devices, () => {
  page.value = 1
})

/** 자식이 올린 것을 그대로 위로 넘긴다. 처리는 화면 하나가 맡는다. */
function forward(event, payload) {
  emit(event, payload)
}
</script>

<template>
  <div>
    <div v-if="mode === 'card'" class="cards">
      <DeviceCard
        v-for="device in shown"
        :key="device.id"
        :device="device"
        :schedules="schedules"
        :selected="selectedIds.includes(device.id)"
        :selectable="selectable"
        :can-manage="canManage"
        :can-create="canCreate"
        @toggle="forward('toggle', $event)"
        @edit="forward('edit', $event)"
        @delegate="forward('delegate', $event)"
        @remove="forward('remove', $event)"
        @edit-schedules="forward('edit-schedules', $event)"
        @command="forward('command', $event)"
        @refresh="forward('refresh', $event)"
      />
    </div>

    <div v-else class="table-scroll">
      <table class="table device-table">
      <thead>
        <tr>
          <th v-if="selectable" class="narrow" />
          <th />
          <th>{{ t('device.name') }}</th>
          <th>{{ t('device.org') }}</th>
          <th>{{ t('device.place') }}</th>
          <th>{{ t('device.spec') }}</th>
          <th>{{ t('device.schedule') }}</th>
          <th>{{ t('user.status') }}</th>
          <th class="right">{{ t('common.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <DeviceListRow
          v-for="device in shown"
          :key="device.id"
          :device="device"
          :schedules="schedules"
          :selected="selectedIds.includes(device.id)"
          :selectable="selectable"
          :can-manage="canManage"
          :can-create="canCreate"
          @toggle="forward('toggle', $event)"
          @edit="forward('edit', $event)"
          @delegate="forward('delegate', $event)"
          @remove="forward('remove', $event)"
          @edit-schedules="forward('edit-schedules', $event)"
          @command="forward('command', $event)"
          @refresh="forward('refresh', $event)"
        />
      </tbody>
      </table>
    </div>

    <!-- 통째로 받아 온 목록에만 붙는다(pageSize > 0). 서버 페이지는 부모가 그린다. -->
    <div v-if="pageCount > 1" class="pager local-pager">
      <button class="btn btn-sm" :disabled="page <= 1" @click="page -= 1">
        {{ t('common.prev') }}
      </button>
      <span class="muted">{{ page }} / {{ pageCount }}</span>
      <button class="btn btn-sm" :disabled="page >= pageCount" @click="page += 1">
        {{ t('common.next') }}
      </button>
      <span class="muted">{{ t('common.totalDevices', { count: devices.length }) }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 카드 폭 하한 300px. 이보다 좁으면 제어 버튼 네 개가 두 줄로 접힌다. */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
  padding: 14px 16px;
}

.table-scroll {
  overflow-x: auto;
}

/* 부모의 서버 페이저와 같은 모양이라야 같은 것으로 읽힌다. */
.local-pager {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.device-table {
  min-width: 900px;
}

.narrow {
  width: 34px;
}

.right {
  text-align: right;
}
</style>
