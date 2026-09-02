<script setup>
/**
 * 이미지·동영상 고르기 레이어.
 *
 * 고르는 일 자체는 `MediaSourcePanel` 이 한다 — 여기는 그것을 레이어에
 * 담고 제목을 붙일 뿐이다. 둘을 가른 이유는 앨범 편집 창 때문이다. 그
 * 창은 같은 고르기 칸을 **레이어 없이** 왼쪽에 세워야 하는데, 창까지
 * 통째로 들어가면 창 안에 창이 뜬다.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import MediaSourcePanel from '@/components/MediaSourcePanel.vue'
import ModalDialog from '@/components/ModalDialog.vue'

const props = defineProps({
  /** 'image' | 'video'. 받을 파일과 라이브러리 목록을 가른다. */
  kind: { type: String, default: 'image' },
  /** 올릴 기관. 없으면 서버가 올리는 사람의 기관으로 잡는다. */
  orgId: { type: Number, default: null },
  /** 지금 요소에 들어 있는 주소. '링크' 탭을 열 때 채워 준다. */
  current: { type: String, default: '' },
  /** 콘텐츠 방향. 검색에서 그 방향 이미지만 찾는 데 쓴다. */
  orientation: { type: String, default: null },
  /** 여러 장을 한 번에 고를지. 켜면 `select-many` 로 배열을 올린다. */
  multiple: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'select', 'select-many'])

const { t } = useI18n()

const isImage = computed(() => props.kind === 'image')
</script>

<template>
  <ModalDialog
    :title="isImage ? t('media.pickImage') : t('media.pickVideo')"
    width="700px"
    hide-footer
    @close="emit('close')"
  >
    <MediaSourcePanel
      :kind="kind"
      :org-id="orgId"
      :current="current"
      :orientation="orientation"
      :multiple="multiple"
      @select="emit('select', $event)"
      @select-many="emit('select-many', $event)"
    />
  </ModalDialog>
</template>
