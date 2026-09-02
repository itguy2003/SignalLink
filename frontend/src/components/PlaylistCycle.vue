<script setup>
/**
 * 캔버스 위에서 도는 재생목록 요소.
 *
 * 편집 중에는 🔁 아이콘과 이름만 보여 주면 충분하다 — 자리와 크기를 잡는 게
 * 일이지 내용을 보는 게 일이 아니다. 하지만 **미리보기에서는 실제로 돌아야**
 * 한다. 그러지 않으면 콘텐츠 미리보기가 장치 화면과 다른 것을 보여 주고,
 * 재생목록이 낀 자리는 확인할 방법이 없다.
 *
 * 시간과 전환은 재생목록 미리보기와 같은 규칙(`useWidgetCycle`)을 쓴다.
 * 문서에는 참조(`playlist_id`)만 있으므로 칸 목록은 여기서 받아 온다 —
 * 플레이어에게는 서버가 채워 내려주는 그 값이다.
 */
import { computed, onMounted, ref } from 'vue'

import { api } from '@/api/client'
import WidgetPreview from '@/components/WidgetPreview.vue'
import { useWidgetCycle } from '@/composables/useWidgetCycle'

const props = defineProps({
  playlistId: { type: Number, default: null },
  /** 서버 위젯 명세. 이름을 보여 주는 데 쓴다. */
  widgets: { type: Array, default: () => [] },
  /** 요소 크기(문서 좌표). 안쪽은 이 크기로 그리고 바깥에서 한 번 줄인다. */
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  scale: { type: Number, default: 1 },
  /** 목록을 못 받았을 때 보여 줄 이름(문서에 남겨 둔 사본). */
  name: { type: String, default: '' },
})

const items = ref([])
const loaded = ref(false)

const specs = computed(() => new Map(props.widgets.map((w) => [w.key, w])))

const { index, current, outgoing, stageStyle, outgoingStyle } = useWidgetCycle(
  () => items.value,
)

const currentSpec = computed(() =>
  current.value ? specs.value.get(current.value.widget_key) : null,
)

const outgoingSpec = computed(() =>
  outgoing.value ? specs.value.get(outgoing.value.widget_key) : null,
)

onMounted(async () => {
  if (!props.playlistId) {
    loaded.value = true
    return
  }
  // 못 받아도 화면은 살아 있어야 한다. 이름만 보여 주고 넘어간다.
  const playlist = await api.get(`/playlists/${props.playlistId}`).catch(() => null)
  items.value = playlist?.items ?? []
  loaded.value = true
})
</script>

<template>
  <div class="cycle">
    <!-- 담긴 위젯이 없거나 못 받았으면 예전처럼 이름만. 빈 검은 화면보다 낫다. -->
    <div v-if="loaded && items.length === 0" class="el-playlist">
      <span class="pl-icon">🔁</span>
      <span class="pl-name">{{ name }}</span>
    </div>

    <template v-else-if="current">
      <div class="layer" :style="stageStyle">
        <WidgetPreview
          playing
          :key="current.widget_key + index"
          :widget-key="current.widget_key"
          :options="current.options ?? {}"
          :name="currentSpec?.name ?? current.widget_key"
          :width="width"
          :height="height"
          :scale="scale"
        />
      </div>

      <!-- 디졸브에서만 남는 앞 화면. 아래에 깔려 사라진다. -->
      <div v-if="outgoing" class="layer out" :style="outgoingStyle">
        <WidgetPreview
          playing
          :widget-key="outgoing.widget_key"
          :options="outgoing.options ?? {}"
          :name="outgoingSpec?.name ?? outgoing.widget_key"
          :width="width"
          :height="height"
          :scale="scale"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.cycle {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

/* 두 겹이 정확히 포개져야 디졸브가 자리 이동 없이 녹아든다. */
.layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  transition-property: opacity, transform, filter, clip-path;
  transition-timing-function: ease;
}

/* 들어오는 화면이 위에 온다. 아래 깔린 앞 화면이 그대로 비쳐 디졸브가 된다. */
.layer:not(.out) {
  z-index: 1;
}

.el-playlist {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: rgb(15 23 42 / 55%);
  color: #f8fafc;
  font-size: 12px;
}

.pl-icon {
  font-size: 20px;
}

.pl-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 90%;
}
</style>
