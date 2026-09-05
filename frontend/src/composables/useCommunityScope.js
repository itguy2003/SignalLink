/**
 * 지금 보는 커뮤니티.
 *
 * 보통 사람에게는 고를 것이 없다 — 서버가 소속 기관으로 정한 커뮤니티 하나뿐
 * 이다. 슈퍼관리자는 **소속과 무관하게 모든 커뮤니티**를 쓰므로 목록이 여러
 * 개로 오고, 그때만 화면이 고르기를 그린다(`canPick`).
 *
 * 커뮤니티 화면 셋(게시판·이미지·동영상·콘텐츠)이 같은 규칙을 써야 하므로
 * 한 곳에 둔다 — 따로 적으면 한 화면만 고르기가 생긴다.
 */
import { computed, ref } from 'vue'

import { api } from '@/api/client'

export function useCommunityScope() {
  /** 쓸 수 있는 커뮤니티들. [{ org_id, org_name, can_share }] */
  const communities = ref([])
  const orgId = ref(null)
  const ready = ref(false)

  /** 지금 고른 커뮤니티. 제목과 올리기 버튼의 근거다. */
  const context = computed(
    () => communities.value.find((c) => c.org_id === orgId.value) ?? null,
  )

  /** 목록이 하나뿐이면 고를 것이 없다. */
  const canPick = computed(() => communities.value.length > 1)

  async function init() {
    try {
      const list = await api.get('/community/list')
      // 목업·오류 응답이 배열이 아닐 수 있다. 배열이 아니면 없는 것과 같다.
      communities.value = Array.isArray(list) ? list : []
      // 기본은 제 소속 커뮤니티. 슈퍼관리자도 고르기 전에는 남들과 같다.
      const mine = await api.get('/community/context')
      orgId.value = mine.org_id
      if (!context.value && communities.value.length) {
        orgId.value = communities.value[0].org_id
      }
    } catch {
      communities.value = []
    } finally {
      ready.value = true
    }
  }

  return { communities, orgId, context, canPick, ready, init }
}
