/**
 * 테스트 모드용 모의 백엔드 (요구사항 제한사항 8).
 *
 * 실제 API 와 같은 경로/응답 형태를 갖고, 기관 트리 기반 권한 규칙도 같은
 * 방식으로 흉내 낸다. 그래야 테스트 모드에서 확인한 화면 동작이 실제 백엔드에
 * 붙였을 때도 그대로 성립한다.
 *
 * 상태는 메모리에만 있고 새로고침하면 시드로 되돌아간다.
 */

import { ApiError } from '../errors'
import { createSeed, mockPhoto, mockScreenshot } from './data'
import { WIDGET_SPECS } from './widgets'
import {
  DEFAULT_TRANSITION_MS,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  TRANSITIONS,
  fitsIn,
} from '@/utils/transitions'

/** 백엔드 `api/v1/devices.py` 의 DEVICE_COMMANDS 와 같아야 한다. */
const DEVICE_COMMANDS = {
  reload: '리로딩',
  restart: '리부팅',
  shutdown: '끄기',
  screenshot: '미리보기',
}

const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일']

// 실제 네트워크처럼 약간의 지연을 준다(로딩 표시가 실제로 보이도록).
// 단위 테스트에서는 불필요하게 느려지므로 0 으로 둔다.
const LATENCY_MS = import.meta.env?.MODE === 'test' ? 0 : 120

function delay() {
  if (LATENCY_MS === 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, LATENCY_MS))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateDeviceCode(existing) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let raw = ''
    for (let i = 0; i < 10; i += 1) {
      raw += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    }
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 7)}-${raw.slice(7)}`
    if (!existing.has(code)) return code
  }
  throw new Error('장치 고유번호 생성 실패')
}

class MockServer {
  constructor() {
    this.reset()
  }

  reset() {
    const seed = createSeed()
    this.organizations = seed.organizations
    this.users = seed.users
    this.contents = seed.contents
    this.schedules = seed.schedules
    this.devices = seed.devices
    this.deviceManagers = seed.deviceManagers
    this.deviceGroups = seed.deviceGroups
    this.playlists = seed.playlists
    this.assets = seed.assets ?? []
    this.boards = seed.boards
    /** 커뮤니티(상위기관 공유 공간). 테스트 모드에서도 흐름을 다 밟을 수 있다. */
    this.communityPosts = []
    this.communityMedia = []
    this.communityMediaPosts = []
    this.communityContents = []
    this.communityPlaylists = []
    this.posts = seed.posts
    this.sessions = new Map()
    this.nextId = {
      org: 100,
      user: 100,
      device: 100,
      schedule: 100,
      item: 100,
      board: 100,
      post: 100,
      content: 100,
      group: 100,
      playlist: 100,
      playlistItem: 100,
      asset: 100,
      communityPost: 100,
      communityMedia: 100,
      communityMediaPost: 100,
      communityContent: 100,
      communityPlaylist: 100,
    }
  }

  // ---------------------------------------------------------------- 권한
  descendantIds(orgId) {
    const result = new Set([orgId])
    let grew = true
    while (grew) {
      grew = false
      for (const org of this.organizations) {
        if (org.parent_id !== null && result.has(org.parent_id) && !result.has(org.id)) {
          result.add(org.id)
          grew = true
        }
      }
    }
    return result
  }

  isSuper(user) {
    return user.roles.includes('SUPER_ADMIN')
  }

  isOrgAdmin(user) {
    return user.roles.includes('ORG_ADMIN')
  }

  /** 관리 가능한 기관 집합. null 이면 전체(슈퍼관리자). */
  managedOrgIds(user) {
    if (this.isSuper(user)) return null
    if (this.isOrgAdmin(user)) return this.descendantIds(user.org_id)
    return new Set([user.org_id])
  }

  canViewOrg(user, orgId) {
    const scope = this.managedOrgIds(user)
    return scope === null || scope.has(orgId)
  }

  canManageOrg(user, orgId) {
    if (this.isSuper(user)) return true
    if (!this.isOrgAdmin(user)) return false
    return this.descendantIds(user.org_id).has(orgId)
  }

  delegatedDeviceIds(user) {
    return new Set(
      this.deviceManagers.filter((link) => link.user_id === user.id).map((link) => link.device_id),
    )
  }

  canViewDevice(user, device) {
    if (this.isSuper(user)) return true
    if (this.isOrgAdmin(user) && this.descendantIds(user.org_id).has(device.org_id)) return true
    if (device.org_id === user.org_id && user.roles.includes('HOMEROOM_TEACHER')) return true
    return this.delegatedDeviceIds(user).has(device.id)
  }

  canManageDevice(user, device) {
    if (this.isSuper(user)) return true
    if (this.isOrgAdmin(user) && this.descendantIds(user.org_id).has(device.org_id)) return true
    return this.delegatedDeviceIds(user).has(device.id)
  }

  // ---------------------------------------------------------------- 조회 헬퍼
  orgName(orgId) {
    return this.organizations.find((o) => o.id === orgId)?.name ?? null
  }

  publicUser(user) {
    return {
      id: user.id,
      user_id: user.user_id,
      name: user.name,
      org_id: user.org_id,
      org_name: this.orgName(user.org_id),
      phone: user.phone,
      email: user.email,
      status: user.status,
      roles: [...user.roles].sort(),
    }
  }

  publicDevice(device) {
    return {
      ...device,
      ...this.deviceStorage(device),
      org_name: this.orgName(device.org_id),
      schedules: this.assignedSchedules(device),
    }
  }

  /**
   * 인증이 필요한 이미지(`api.imageUrl`)의 테스트 모드 대응.
   *
   * 실제 서버는 바이트를 내려주고 클라이언트가 objectURL 을 만든다. 여기서는
   * 곧바로 쓸 수 있는 데이터 URL 을 돌려준다 — 화면 코드는 어느 쪽인지 모른다.
   */
  imageUrl(path) {
    const match = /^\/devices\/(\d+)\/screenshot$/.exec(path)
    if (!match) return null

    const device = this.devices.find((d) => d.id === Number(match[1]))
    // 캡처를 올린 적 없는 장치는 실제 서버에서도 404 다.
    if (!device || !device.screenshot_at) return null
    return mockScreenshot(device, this.assignedSchedules(device)[0]?.name)
  }

  /**
   * 저장공간 파생값. 백엔드 `services/storage.py` 와 같은 규칙이다.
   *
   * 여기가 어긋나면 테스트 모드에서만 경고가 뜨거나 안 뜨는 화면이 생긴다.
   * null 은 '미보고'이며 0(여유)과 구분해야 한다.
   */
  deviceStorage(device) {
    const total = device.storage_total_bytes
    const free = device.storage_free_bytes
    const computable =
      typeof total === 'number' &&
      typeof free === 'number' &&
      total > 0 &&
      free >= 0 &&
      free <= total

    if (!computable) {
      return { storage_used_bytes: null, storage_usage: null, storage_warning: false }
    }
    const usage = (total - free) / total
    return {
      storage_used_bytes: total - free,
      storage_usage: usage,
      // 임계치 0.8. 백엔드 storage.WARN_THRESHOLD 와 같은 값이어야 한다.
      storage_warning: usage >= 0.8,
    }
  }

  /**
   * 장치그룹 응답. 지워진 장치는 걸러 낸다.
   *
   * 실제 서버는 FK CASCADE 로 관계 행이 함께 지워지지만, 여기서는 id 배열이라
   * 장치를 지워도 남는다. 목록에 없는 장치가 섞이면 화면이 빈 항목을 그린다.
   */
  publicGroup(group) {
    const alive = new Set(this.devices.map((d) => d.id))
    return {
      id: group.id,
      name: group.name,
      user_id: group.user_id,
      device_ids: group.device_ids.filter((id) => alive.has(id)),
    }
  }

  /**
   * 장치에 배정된 스케줄. 백엔드 `AssignedSchedule` 과 같은 모양이다.
   *
   * `active` 는 지금 사용 기간 안인지다. 기간 밖이면 걸려 있어도 표출되지
   * 않으므로 화면이 둘을 구분해 보여 줄 수 있어야 한다.
   */
  assignedSchedules(device) {
    const now = Date.now()
    return (device.schedule_ids ?? [])
      .map((id) => this.schedules.find((s) => s.id === id))
      .filter(Boolean)
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        orientation: s.orientation ?? 'LANDSCAPE',
        start_at: s.start_at ?? null,
        end_at: s.end_at ?? null,
        active:
          (!s.start_at || now >= Date.parse(s.start_at)) &&
          (!s.end_at || now <= Date.parse(s.end_at)),
      }))
  }

  /** 배정 목록을 통째로 교체한다. 순서가 곧 우선순위, 중복은 한 번만. */
  replaceDeviceSchedules(device, scheduleIds) {
    const unique = [...new Set(scheduleIds ?? [])]
    for (const id of unique) {
      if (!this.schedules.some((s) => s.id === id)) {
        throw new ApiError(400, '존재하지 않는 스케줄입니다.')
      }
    }
    device.schedule_ids = unique
  }

  /** 담을 수 있는 장치인지 확인하고 중복을 없앤 목록을 돌려준다. */
  assertGroupDevices(user, deviceIds) {
    const unique = [...new Set(deviceIds)]
    for (const id of unique) {
      const device = this.devices.find((d) => d.id === id)
      if (!device) throw new ApiError(400, '존재하지 않는 장치가 포함되어 있습니다.')
      if (!this.canViewDevice(user, device)) {
        throw new ApiError(403, `장치 '${device.name}' 에 접근할 권한이 없습니다.`)
      }
    }
    return unique
  }

  ownedGroup(user, groupId) {
    const group = this.deviceGroups.find((g) => g.id === groupId)
    if (!group) throw new ApiError(404, '장치그룹을(를) 찾을 수 없습니다.')
    if (group.user_id !== user.id) {
      throw new ApiError(403, '본인이 만든 그룹만 수정할 수 있습니다.')
    }
    return group
  }

  /** 재생목록을 쓰는 콘텐츠 수. 콘텐츠 문서를 훑어 센다. */
  playlistUsage(playlistId) {
    return this.contents.filter((content) =>
      (content.document?.elements ?? []).some(
        (el) => el?.type === 'playlist' && el?.options?.playlist_id === playlistId,
      ),
    ).length
  }

  publicPlaylist(playlist) {
    return {
      ...clone(playlist),
      org_name: this.orgName(playlist.org_id),
      usage_count: this.playlistUsage(playlist.id),
      total_duration_sec: playlist.items.reduce((sum, i) => sum + i.duration_sec, 0),
    }
  }

  /** 전환 효과 이름 검사(서버 스키마와 같은 규칙). 안 주면 '없음'. */
  checkedTransition(value) {
    if (value === undefined || value === null) return 'none'
    if (!TRANSITIONS.includes(value)) {
      throw new ApiError(422, `알 수 없는 전환 효과입니다: ${value}`)
    }
    return value
  }

  /**
   * 전환 시간 검사(서버 스키마와 같은 규칙).
   *
   * 범위 밖이면 거부하고, 그 칸의 표출 시간보다 길어도 거부한다 — 효과가
   * 끝나기 전에 넘어가면 화면이 영영 제자리에 놓이지 않는다.
   */
  checkedTransitionMs(item, index) {
    const ms = item.transition_ms ?? DEFAULT_TRANSITION_MS
    if (ms < MIN_TRANSITION_MS || ms > MAX_TRANSITION_MS) {
      throw new ApiError(422, `${index + 1}번째 칸의 전환 시간이 범위를 벗어났습니다.`)
    }
    if (!fitsIn(item.transition, ms, item.duration_sec ?? 10)) {
      throw new ApiError(422, '전환 시간은 표출 시간보다 길 수 없습니다.')
    }
    return ms
  }

  /** 자산 하나의 공개 모양. 주소는 서버가 정한다(편집기가 규칙을 모르게). */
  /** 소속 기관에서 위로 올라가 처음 만나는 '기관'. 커뮤니티가 걸린 자리다. */
  communityOrgOf(user) {
    let org = this.organizations.find((o) => o.id === user.org_id) ?? null
    const seen = new Set()
    while (org && !seen.has(org.id)) {
      seen.add(org.id)
      if (org.org_type === '기관') return org
      org = this.organizations.find((o) => o.id === org.parent_id) ?? null
    }
    return null
  }

  /** FormData 에서 파일 메타만 받아 자산을 흉내 낸다(테스트 모드 공통). */
  mockAssetFromForm(user, body) {
    const file = body?.get?.('file') ?? null
    if (!file) throw new ApiError(400, '빈 파일입니다.')
    const kind = String(file.type || '').startsWith('video/') ? 'video' : 'image'
    const asset = {
      id: this.nextId.asset++,
      org_id: user.org_id,
      uploaded_by: user.id,
      kind,
      filename: file.name || 'upload',
      content_type: file.type || 'application/octet-stream',
      size_bytes: file.size || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      mock_url:
        typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : '',
    }
    this.assets.push(asset)
    return asset
  }

  publicAsset(asset) {
    const url = asset.mock_url || `/api/v1/assets/${asset.id}/${asset.token ?? 'mock'}/file`
    return {
      ...clone(asset),
      // 열쇠가 붙은 주소. 실제 서버와 같은 모양이라야 화면 코드가 같게 돈다.
      url,
      // 실제 서버는 올릴 때 축소본을 만든다. 목업은 이미지에는 원본을 그대로
      // 물리고(그릴 수는 있어야 하니), 동영상에는 없음을 줘서 물러나는
      // 경로(<video preload>)도 굴려 본다.
      thumb_url: asset.kind === 'image' ? url : null,
      org_name: this.orgName(asset.org_id),
      usage_count: this.assetUsage(asset.id),
    }
  }

  /** 칸이 전부 이 커뮤니티의 공유물인지 검사하고 저장 모양으로 만든다. */
  cleanCommunityPlaylistItems(orgId, items) {
    if (!items || items.length === 0) throw new ApiError(400, '칸을 하나 이상 담아야 합니다.')
    return items.map((item) => {
      const row = this.communityMedia.find(
        (m) => m.org_id === orgId && m.asset.id === item.asset_id && m.asset.kind === item.kind,
      )
      if (!row) throw new ApiError(400, '커뮤니티에 공유된 이미지·동영상만 담을 수 있습니다.')
      return {
        kind: item.kind,
        asset_id: item.asset_id,
        duration_sec: item.duration_sec,
        ...(item.transition && item.transition !== 'none'
          ? { transition: item.transition, transition_ms: item.transition_ms ?? 600 }
          : {}),
      }
    })
  }

  /** 게시글에 파일들을 자산으로 담는다. 갈래가 다르면 거절 — 실제 서버와 같다. */
  mockAddMediaFiles(user, post, files) {
    for (const file of files) {
      const kind = String(file.type || '').startsWith('video/') ? 'video' : 'image'
      if (kind !== post.kind) {
        throw new ApiError(400, '이 게시글에는 같은 갈래의 파일만 담을 수 있습니다.')
      }
    }
    for (const file of files) {
      const form = new FormData()
      form.append('file', file)
      const asset = this.mockAssetFromForm(user, form)
      const row = {
        id: this.nextId.communityMedia++,
        org_id: post.org_id,
        post_id: post.id,
        asset_id: asset.id,
        asset: this.publicAsset(asset),
      }
      this.communityMedia.push(row)
      post.item_ids.push(row.id)
    }
  }

  /** 게시글 응답 — 담긴 파일에 주소를 붙여 함께 준다. */
  publicMediaPost(post) {
    const items = post.item_ids
      .map((id) => this.communityMedia.find((m) => m.id === id))
      .filter(Boolean)
      .map((m) => ({ id: m.id, asset: this.publicAsset(this.assets.find((a) => a.id === m.asset.id) ?? m.asset) }))
    return {
      id: post.id,
      kind: post.kind,
      title: post.title,
      description: post.description ?? '',
      author_id: post.author_id,
      author_name: post.author_name,
      created_at: post.created_at,
      items,
      item_count: items.length,
      can_remove: true,
    }
  }

  /** 저장된 칸에 화면이 그릴 이름·주소를 붙인다. 공유가 거둬진 것은 건너뛴다. */
  publicCommunityPlaylist(playlist) {
    const items = (playlist.items ?? []).flatMap((item) => {
      const row = this.communityMedia.find(
        (m) => m.org_id === playlist.org_id && m.asset.id === item.asset_id,
      )
      if (!row) return []
      return [{ ...item, title: row.title || row.asset.filename, url: row.asset.url }]
    })
    return { ...playlist, items }
  }

  /** 이 파일을 쓰는 콘텐츠 수. 문서의 src 를 훑는다(서버는 색인을 쓴다). */
  assetUsage(assetId) {
    const marker = `/assets/${assetId}/`
    return this.contents.filter((content) =>
      (content.document?.elements ?? []).some(
        (el) => typeof el?.src === 'string' && el.src.includes(marker),
      ),
    ).length
  }

  playlistItems(items) {
    const known = new Set(WIDGET_SPECS.map((w) => w.key))
    return items.map((item, index) => {
      if (!known.has(item.widget_key)) {
        throw new ApiError(400, `알 수 없는 위젯입니다: ${item.widget_key}`)
      }
      return {
        id: this.nextId.playlistItem++,
        sort_order: index,
        widget_key: item.widget_key,
        duration_sec: item.duration_sec ?? 10,
        options: item.options ?? {},
        // 서버와 같은 규칙: 모르는 이름은 거부한다. 받아 두면 장치마다
        // 다르게 넘어간다.
        transition: this.checkedTransition(item.transition),
        transition_ms: this.checkedTransitionMs(item, index),
      }
    })
  }

  ownedPlaylist(user, playlistId) {
    const playlist = this.playlists.find((p) => p.id === playlistId)
    if (!playlist) throw new ApiError(404, '재생목록을(를) 찾을 수 없습니다.')
    if (!this.canManageOrg(user, playlist.org_id) && playlist.created_by !== user.id) {
      throw new ApiError(403, '해당 재생목록을 수정할 권한이 없습니다.')
    }
    return playlist
  }

  contentUsage(contentId) {
    return this.schedules.reduce(
      (total, schedule) =>
        total + schedule.items.filter((item) => item.content_id === contentId).length,
      0,
    )
  }

  contentSummary(content) {
    const document = content.document ?? {}
    return {
      id: content.id,
      name: content.name,
      description: content.description ?? null,
      org_id: content.org_id,
      org_name: this.orgName(content.org_id),
      created_by: content.created_by,
      width: content.width,
      height: content.height,
      version: content.version,
      created_at: content.created_at,
      updated_at: content.updated_at,
      usage_count: this.contentUsage(content.id),
      element_count: (document.elements ?? []).length,
      background: (document.layout ?? {}).background ?? '#000000',
    }
  }

  /** 아이템에 콘텐츠 이름을 붙여 준다. 주간 편집기 블록 라벨에 쓰인다. */
  publicItem(item) {
    const content = item.content_id
      ? this.contents.find((c) => c.id === item.content_id)
      : null
    return { ...clone(item), content_name: content?.name ?? null }
  }

  publicSchedule(schedule, { withItems = false } = {}) {
    const base = {
      id: schedule.id,
      name: schedule.name,
      kind: schedule.kind,
      orientation: schedule.orientation ?? 'LANDSCAPE',
      start_at: schedule.start_at ?? null,
      end_at: schedule.end_at ?? null,
      org_id: schedule.org_id,
      created_by: schedule.created_by,
      version: schedule.version,
      created_at: schedule.created_at,
      updated_at: schedule.updated_at,
      device_count: this.devices.filter((d) => (d.schedule_ids ?? []).includes(schedule.id)).length,
    }
    return withItems ? { ...base, items: schedule.items.map((i) => this.publicItem(i)) } : base
  }

  /** 실제 서버와 같은 저장 규칙으로 아이템을 정규화한다. */
  normalizeItems(schedule, items) {
    return items.map((item, index) => ({
      id: this.nextId.item++,
      schedule_id: schedule.id,
      day_of_week: item.day_of_week ?? -1,
      start_time: item.start_time ?? null,
      end_time: item.end_time ?? null,
      sort_order: item.sort_order ?? index,
      duration_sec: item.duration_sec ?? 10,
      content_id: item.content_id ?? null,
      // 참조 방식이면 인라인 사본을 남기지 않는다(정본이 둘이 되면 안 된다).
      content: item.content_id ? {} : (item.content ?? {}),
    }))
  }

  /**
   * 사용 기간의 앞뒤가 뒤집혔으면 거부한다(서버와 같은 규칙).
   *
   * 뒤집힌 기간은 '언제나 기간 밖'이 되어 아무 때도 표출되지 않는다.
   * 저장은 됐는데 화면만 안 나오는 상태라 원인을 찾기 어렵다.
   */
  assertPeriod(startAt, endAt) {
    if (startAt && endAt && new Date(startAt) >= new Date(endAt)) {
      throw new ApiError(400, '종료일시는 시작일시보다 뒤여야 합니다.')
    }
  }

  /** 같은 요일에 시간대가 겹치면 거부한다(서버와 같은 규칙). */
  assertNoOverlap(items) {
    const byDay = {}
    for (const item of items) {
      if (item.start_time && item.end_time) {
        ;(byDay[item.day_of_week ?? -1] ??= []).push(item)
      }
    }
    for (const [day, dayItems] of Object.entries(byDay)) {
      const ordered = [...dayItems].sort((a, b) => a.start_time.localeCompare(b.start_time))
      for (let i = 1; i < ordered.length; i += 1) {
        if (ordered[i].start_time < ordered[i - 1].end_time) {
          const label = DAY_NAMES[Number(day)] ?? '요일 미지정'
          throw new ApiError(
            400,
            `${label}요일의 시간대가 겹칩니다: ` +
              `${ordered[i - 1].start_time}~${ordered[i - 1].end_time} 과 ` +
              `${ordered[i].start_time}~${ordered[i].end_time}`,
          )
        }
      }
    }
  }

  assertContentsUsable(user, items) {
    for (const item of items) {
      if (!item.content_id) continue
      const content = this.contents.find((c) => c.id === item.content_id)
      if (!content) throw new ApiError(400, `존재하지 않는 콘텐츠입니다: ${item.content_id}`)
      if (!this.canViewOrg(user, content.org_id)) {
        throw new ApiError(403, `콘텐츠 '${content.name}' 을(를) 사용할 권한이 없습니다.`)
      }
    }
  }

  /**
   * 스케줄 방향과 콘텐츠 방향이 같은지 검사한다.
   *
   * 백엔드 `api/v1/schedules.py` 의 `_assert_orientation` 과 같은 규칙이다.
   * 여기가 느슨하면 테스트 모드에서만 되고 실서버에서 거부되는 화면이 생긴다.
   */
  assertOrientation(items, expected) {
    const label = (value) => (value === 'PORTRAIT' ? '세로형' : '가로형')
    const of = (width, height) => (height > width ? 'PORTRAIT' : 'LANDSCAPE')
    const want = label(expected)

    for (const item of items) {
      if (item.content_id) {
        const content = this.contents.find((c) => c.id === item.content_id)
        if (!content) continue // 존재 검사는 assertContentsUsable 이 한다.
        const actual = of(content.width, content.height)
        if (actual !== expected) {
          throw new ApiError(
            400,
            `${want} 스케줄에는 ${want} 콘텐츠만 넣을 수 있습니다. ` +
              `'${content.name}' 은(는) ${label(actual)}(${content.width}×${content.height})입니다.`,
          )
        }
        continue
      }
      // 인라인 콘텐츠. 크기를 모르면 통과시킨다 — 빈 아이템까지 막으면 편집을 시작할 수 없다.
      const layout = item.content?.layout
      if (typeof layout?.width !== 'number' || typeof layout?.height !== 'number') continue
      const actual = of(layout.width, layout.height)
      if (actual !== expected) {
        throw new ApiError(
          400,
          `${want} 스케줄에는 ${want} 콘텐츠만 넣을 수 있습니다. ` +
            `${label(actual)}(${layout.width}×${layout.height}) 콘텐츠가 들어 있습니다.`,
        )
      }
    }
  }

  paginate(items, params) {
    const page = Number(params?.page ?? 1)
    const size = Number(params?.size ?? 20)
    const start = (page - 1) * size
    return { items: items.slice(start, start + size), total: items.length, page, size }
  }

  requireUser(token) {
    const user = this.sessions.get(token)
    if (!user) throw new ApiError(401, '인증 정보가 없습니다. 다시 로그인하세요.')
    return user
  }

  // ---------------------------------------------------------------- 라우팅
  async handle(method, path, { body, params, token } = {}) {
    await delay()
    // 숫자 경로 조각은 :id 로, 위젯 키는 :key 로 정규화해 라우트 표에서 찾는다.
    const route = `${method} ${path.replace(/^\/widgets\/[^/]+\/data$/, '/widgets/:key/data').replace(/\/\d+/g, '/:id')}`
    const ids = (path.match(/\/(\d+)/g) || []).map((segment) => Number(segment.slice(1)))
    const handler = this.routes()[route]
    if (!handler) {
      throw new ApiError(404, `테스트 모드에서 지원하지 않는 경로입니다: ${method} ${path}`)
    }
    return clone(handler({ body, params: params ?? {}, token, ids }))
  }

  routes() {
    return {
      // ------------------------------------------------------------ 인증
      'POST /auth/login': ({ body }) => {
        const user = this.users.find((u) => u.user_id === body.user_id)
        if (!user || user.password !== body.password) {
          throw new ApiError(401, '사용자ID 또는 비밀번호가 올바르지 않습니다.')
        }
        if (user.status !== '승인') {
          throw new ApiError(403, '승인 대기 중인 계정입니다. 기관 관리자에게 문의하세요.')
        }
        const newToken = `mock-${user.id}-${Date.now()}`
        this.sessions.set(newToken, user)
        return {
          access_token: newToken,
          token_type: 'bearer',
          expires_in: 28800,
          user: this.publicUser(user),
        }
      },

      'GET /auth/check-user-id': ({ params }) => ({
        user_id: params.user_id,
        available: !this.users.some((u) => u.user_id === params.user_id),
      }),

      'POST /auth/register': ({ body }) => {
        if (this.users.some((u) => u.user_id === body.user_id)) {
          throw new ApiError(400, '이미 사용 중인 사용자ID 입니다.')
        }
        const user = {
          id: this.nextId.user++,
          user_id: body.user_id,
          password: body.password,
          name: body.name,
          org_id: body.org_id,
          phone: body.phone ?? null,
          email: body.email ?? null,
          status: '미승인',
          roles: ['MEMBER'],
        }
        this.users.push(user)
        return this.publicUser(user)
      },

      'GET /auth/me': ({ token }) => this.publicUser(this.requireUser(token)),

      'POST /auth/change-password': ({ token, body }) => {
        const user = this.requireUser(token)
        if (user.password !== body.current_password) {
          throw new ApiError(400, '현재 비밀번호가 올바르지 않습니다.')
        }
        user.password = body.new_password
        return { detail: '비밀번호가 변경되었습니다.' }
      },

      // ------------------------------------------------------------ 기관
      // 로그인 전에도 소속기관을 골라야 한다. 이름과 id 만 노출한다.
      'GET /organizations/public': ({ params }) => {
        let items = this.organizations
        if (params?.q) items = items.filter((o) => o.name.includes(params.q))
        if (params?.limit) items = items.slice(0, Number(params.limit))
        return items.map((o) => ({ id: o.id, name: o.name, parent_id: o.parent_id }))
      },

      'GET /organizations': ({ token, params }) => {
        const user = this.requireUser(token)
        const scope = this.managedOrgIds(user)
        let items = this.organizations.filter((o) => scope === null || scope.has(o.id))
        if (params.q) items = items.filter((o) => o.name.includes(params.q))
        // limit 은 검색 상자용이다. 안 주면 예전처럼 전부 돌려준다.
        return params.limit ? items.slice(0, Number(params.limit)) : items
      },

      'GET /organizations/tree': ({ token }) => {
        const user = this.requireUser(token)
        const scope = this.managedOrgIds(user)
        const visible = this.organizations.filter((o) => scope === null || scope.has(o.id))
        const nodes = new Map(visible.map((o) => [o.id, { ...o, children: [] }]))
        const roots = []
        for (const org of visible) {
          const node = nodes.get(org.id)
          const parent = org.parent_id === null ? null : nodes.get(org.parent_id)
          if (parent) parent.children.push(node)
          else roots.push(node)
        }
        return roots
      },

      'GET /organizations/:id': ({ token, ids }) => {
        const user = this.requireUser(token)
        const org = this.organizations.find((o) => o.id === ids[0])
        if (!org) throw new ApiError(404, '기관을(를) 찾을 수 없습니다.')
        if (!this.canViewOrg(user, org.id)) throw new ApiError(403, '해당 기관을 조회할 권한이 없습니다.')
        return org
      },

      'POST /organizations': ({ token, body }) => {
        const user = this.requireUser(token)
        if (body.parent_id == null) {
          throw new ApiError(400, '최상위 기관은 이미 존재합니다. 상위 기관을 지정하세요.')
        }
        if (!this.canManageOrg(user, body.parent_id)) {
          throw new ApiError(403, '기관을 등록할 권한이 없습니다.')
        }
        const org = { id: this.nextId.org++, ...body }
        this.organizations.push(org)
        return org
      },

      'PUT /organizations/:id': ({ token, body, ids }) => {
        const user = this.requireUser(token)
        const org = this.organizations.find((o) => o.id === ids[0])
        if (!org) throw new ApiError(404, '기관을(를) 찾을 수 없습니다.')
        if (!this.canManageOrg(user, org.id)) {
          throw new ApiError(403, '해당 기관을 수정할 권한이 없습니다.')
        }
        if (body.parent_id !== undefined && body.parent_id !== null) {
          if (this.descendantIds(org.id).has(body.parent_id)) {
            throw new ApiError(400, '상위 기관 변경이 순환 구조를 만듭니다.')
          }
        }
        Object.assign(org, body)
        return org
      },

      'DELETE /organizations/:id': ({ token, ids }) => {
        const user = this.requireUser(token)
        const org = this.organizations.find((o) => o.id === ids[0])
        if (!org) throw new ApiError(404, '기관을(를) 찾을 수 없습니다.')
        if (org.parent_id === null) throw new ApiError(400, '최상위 기관은 삭제할 수 없습니다.')
        if (!this.canManageOrg(user, org.id)) {
          throw new ApiError(403, '해당 기관을 삭제할 권한이 없습니다.')
        }
        const children = this.organizations.filter((o) => o.parent_id === org.id).length
        if (children) throw new ApiError(400, `하위 기관이 ${children}건 있어 삭제할 수 없습니다.`)
        const members = this.users.filter((u) => u.org_id === org.id).length
        if (members) throw new ApiError(400, `소속 사용자가 ${members}명 있어 삭제할 수 없습니다.`)
        const owned = this.devices.filter((d) => d.org_id === org.id).length
        if (owned) throw new ApiError(400, `소속 장치가 ${owned}대 있어 삭제할 수 없습니다.`)
        this.organizations = this.organizations.filter((o) => o.id !== org.id)
        return { detail: '기관이 삭제되었습니다.' }
      },

      // ------------------------------------------------------------ 사용자
      'GET /users': ({ token, params }) => {
        const user = this.requireUser(token)
        const scope = this.managedOrgIds(user)
        let items = this.users.filter((u) => scope === null || scope.has(u.org_id))
        if (params.q) {
          items = items.filter((u) => u.name.includes(params.q) || u.user_id.includes(params.q))
        }
        if (params.status) items = items.filter((u) => u.status === params.status)
        if (params.org_id) {
          const sub = this.descendantIds(Number(params.org_id))
          items = items.filter((u) => sub.has(u.org_id))
        }
        if (params.role) items = items.filter((u) => u.roles.includes(params.role))
        return this.paginate(items.map((u) => this.publicUser(u)), params)
      },

      'GET /users/pending-count': ({ token }) => {
        const user = this.requireUser(token)
        const scope = this.managedOrgIds(user)
        const count = this.users.filter(
          (u) => u.status === '미승인' && (scope === null || scope.has(u.org_id)),
        ).length
        return { count }
      },

      'POST /users': ({ token, body }) => {
        const actor = this.requireUser(token)
        if (!this.canManageOrg(actor, body.org_id)) {
          throw new ApiError(403, '해당 기관에 사용자를 등록할 권한이 없습니다.')
        }
        if (this.users.some((u) => u.user_id === body.user_id)) {
          throw new ApiError(400, '이미 사용 중인 사용자ID 입니다.')
        }
        const roles = [...new Set(['MEMBER', ...(body.roles ?? [])])]
        if (!this.isSuper(actor) && roles.includes('SUPER_ADMIN')) {
          throw new ApiError(403, 'SUPER_ADMIN 역할을 부여할 권한이 없습니다.')
        }
        const created = {
          id: this.nextId.user++,
          user_id: body.user_id,
          password: body.password,
          name: body.name,
          org_id: body.org_id,
          phone: body.phone ?? null,
          email: body.email ?? null,
          status: '승인',
          roles,
        }
        this.users.push(created)
        return this.publicUser(created)
      },

      'PUT /users/:id': ({ token, body, ids }) => {
        const actor = this.requireUser(token)
        const target = this.users.find((u) => u.id === ids[0])
        if (!target) throw new ApiError(404, '사용자을(를) 찾을 수 없습니다.')
        if (!this.canManageOrg(actor, target.org_id) && actor.id !== target.id) {
          throw new ApiError(403, '해당 사용자를 수정할 권한이 없습니다.')
        }
        if (body.roles) {
          if (actor.id === target.id && !this.isSuper(actor)) {
            throw new ApiError(403, '자신의 역할은 변경할 수 없습니다.')
          }
          if (!this.isSuper(actor) && body.roles.includes('SUPER_ADMIN')) {
            throw new ApiError(403, 'SUPER_ADMIN 역할을 부여할 권한이 없습니다.')
          }
          target.roles = [...new Set(['MEMBER', ...body.roles])]
        }
        for (const field of ['name', 'phone', 'email', 'org_id', 'status']) {
          if (body[field] !== undefined) target[field] = body[field]
        }
        if (body.password) target.password = body.password
        return this.publicUser(target)
      },

      'POST /users/:id/approve': ({ token, ids }) => {
        const actor = this.requireUser(token)
        const target = this.users.find((u) => u.id === ids[0])
        if (!target) throw new ApiError(404, '사용자을(를) 찾을 수 없습니다.')
        if (!this.canManageOrg(actor, target.org_id)) {
          throw new ApiError(403, '해당 사용자를 승인할 권한이 없습니다.')
        }
        target.status = '승인'
        return this.publicUser(target)
      },

      'POST /users/:id/reject': ({ token, ids }) => {
        const actor = this.requireUser(token)
        const target = this.users.find((u) => u.id === ids[0])
        if (!target) throw new ApiError(404, '사용자을(를) 찾을 수 없습니다.')
        if (!this.canManageOrg(actor, target.org_id)) {
          throw new ApiError(403, '해당 사용자의 승인을 취소할 권한이 없습니다.')
        }
        target.status = '미승인'
        return this.publicUser(target)
      },

      'DELETE /users/:id': ({ token, ids }) => {
        const actor = this.requireUser(token)
        const target = this.users.find((u) => u.id === ids[0])
        if (!target) throw new ApiError(404, '사용자을(를) 찾을 수 없습니다.')
        if (target.id === actor.id) throw new ApiError(400, '자기 자신은 삭제할 수 없습니다.')
        if (!this.canManageOrg(actor, target.org_id)) {
          throw new ApiError(403, '해당 사용자를 삭제할 권한이 없습니다.')
        }
        this.users = this.users.filter((u) => u.id !== target.id)
        return { detail: '사용자가 삭제되었습니다.' }
      },

      // ------------------------------------------------------------ 장치
      'GET /devices': ({ token, params }) => {
        const user = this.requireUser(token)
        let items = this.devices.filter((d) => this.canViewDevice(user, d))
        if (params.q) {
          const q = params.q
          items = items.filter(
            (d) => d.name.includes(q) || d.device_code.includes(q) || (d.place_name ?? '').includes(q),
          )
        }
        if (params.org_id) {
          const sub = this.descendantIds(Number(params.org_id))
          items = items.filter((d) => sub.has(d.org_id))
        }
        if (params.unassigned) items = items.filter((d) => (d.schedule_ids ?? []).length === 0)
        return this.paginate(items.map((d) => this.publicDevice(d)), params)
      },

      'GET /devices/:id': ({ token, ids }) => {
        const user = this.requireUser(token)
        const device = this.devices.find((d) => d.id === ids[0])
        if (!device) throw new ApiError(404, '장치을(를) 찾을 수 없습니다.')
        if (!this.canViewDevice(user, device)) {
          throw new ApiError(403, '해당 장치를 조회할 권한이 없습니다.')
        }
        return this.publicDevice(device)
      },

      'POST /devices': ({ token, body }) => {
        const user = this.requireUser(token)
        if (!this.canManageOrg(user, body.org_id)) {
          throw new ApiError(403, '해당 기관에 장치를 등록할 권한이 없습니다.')
        }
        const existing = new Set(this.devices.map((d) => d.device_code))
        const device = {
          id: this.nextId.device++,
          ...body,
          // 고유번호는 서버가 만든다. 클라이언트가 보낸 값은 무시한다.
          device_code: generateDeviceCode(existing),
          version: 0,
          last_seen_at: null,
          app_version: null,
          online: false,
          schedule_ids: [...new Set(body.schedule_ids ?? [])],
        }
        this.devices.push(device)
        return this.publicDevice(device)
      },

      'PUT /devices/:id': ({ token, body, ids }) => {
        const user = this.requireUser(token)
        const device = this.devices.find((d) => d.id === ids[0])
        if (!device) throw new ApiError(404, '장치을(를) 찾을 수 없습니다.')
        if (!this.canManageDevice(user, device)) {
          throw new ApiError(403, '해당 장치를 수정할 권한이 없습니다.')
        }
        const { device_code, ...editable } = body
        Object.assign(device, editable)
        return this.publicDevice(device)
      },

      'DELETE /devices/:id': ({ token, ids }) => {
        const user = this.requireUser(token)
        const device = this.devices.find((d) => d.id === ids[0])
        if (!device) throw new ApiError(404, '장치을(를) 찾을 수 없습니다.')
        // 등록/삭제 권한은 기관관리자와 슈퍼관리자만 갖는다.
        if (!this.canManageOrg(user, device.org_id)) {
          throw new ApiError(403, '해당 장치를 삭제할 권한이 없습니다.')
        }
        this.devices = this.devices.filter((d) => d.id !== device.id)
        this.deviceManagers = this.deviceManagers.filter((l) => l.device_id !== device.id)
        return { detail: '장치가 삭제되었습니다.' }
      },

      // 배정을 통째로 교체한다. 빈 목록이면 데모 모드.
      'PUT /devices/:id/schedules': ({ token, body, ids }) => {
        const user = this.requireUser(token)
        const device = this.devices.find((d) => d.id === ids[0])
        if (!device) throw new ApiError(404, '장치을(를) 찾을 수 없습니다.')
        if (!this.canManageDevice(user, device)) {
          throw new ApiError(403, '해당 장치의 스케줄을 변경할 권한이 없습니다.')
        }
        this.replaceDeviceSchedules(device, body.schedule_ids)
        return this.publicDevice(device)
      },

      'POST /devices/schedule/bulk': ({ token, body }) => {
        const user = this.requireUser(token)
        const targets = this.devices.filter((d) => body.device_ids.includes(d.id))
        for (const device of targets) {
          if (!this.canManageDevice(user, device)) {
            throw new ApiError(403, `장치 '${device.name}' 의 스케줄을 변경할 권한이 없습니다.`)
          }
        }
        for (const device of targets) this.replaceDeviceSchedules(device, body.schedule_ids)
        return { detail: `${targets.length}대의 장치에 스케줄을 배정했습니다.` }
      },

      'GET /devices/:id/managers': ({ token, ids }) => {
        this.requireUser(token)
        const linked = this.deviceManagers
          .filter((l) => l.device_id === ids[0])
          .map((l) => this.users.find((u) => u.id === l.user_id))
          .filter(Boolean)
        return linked.map((u) => this.publicUser(u))
      },

      'PUT /devices/:id/managers': ({ token, body, ids }) => {
        const actor = this.requireUser(token)
        const device = this.devices.find((d) => d.id === ids[0])
        if (!device) throw new ApiError(404, '장치을(를) 찾을 수 없습니다.')
        if (!this.canManageOrg(actor, device.org_id)) {
          throw new ApiError(403, '장치 관리를 위임할 권한이 없습니다.')
        }
        for (const userId of body.user_ids) {
          const target = this.users.find((u) => u.id === userId)
          if (!target) throw new ApiError(400, '존재하지 않는 사용자가 포함되어 있습니다.')
          if (!target.roles.includes('DEVICE_MANAGER')) {
            throw new ApiError(400, `'${target.name}' 에게 DEVICE_MANAGER 역할이 없습니다.`)
          }
        }
        this.deviceManagers = this.deviceManagers.filter((l) => l.device_id !== device.id)
        for (const userId of body.user_ids) {
          this.deviceManagers.push({ device_id: device.id, user_id: userId })
        }
        return { detail: `${body.user_ids.length}명에게 장치 관리를 위임했습니다.` }
      },

      'POST /devices/:id/command': ({ token, ids, params }) => {
        const user = this.requireUser(token)
        const device = this.devices.find((d) => d.id === ids[0])
        if (!device) throw new ApiError(404, '장치을(를) 찾을 수 없습니다.')
        if (!this.canManageDevice(user, device)) {
          throw new ApiError(403, '해당 장치를 제어할 권한이 없습니다.')
        }
        if (!DEVICE_COMMANDS[params.command]) {
          throw new ApiError(400, '지원하지 않는 명령입니다.')
        }
        if (!device.online) throw new ApiError(400, '장치가 접속되어 있지 않습니다.')

        // 실제 장치는 screenshot 명령을 받고 캡처를 올린다. 여기서는 올라온 셈 친다.
        if (params.command === 'screenshot') {
          device.screenshot_at = new Date().toISOString()
        }
        return { detail: `'${DEVICE_COMMANDS[params.command]}' 명령을 전송했습니다.` }
      },

      // ------------------------------------------------------------ 재생목록
      // ----------------------------------------------------------- 자산
      //
      // 실제 업로드는 흉내만 낸다. 테스트 모드는 파일 시스템이 없으므로
      // blob: 주소를 만들어 화면에서 보이게만 한다 — 새로고침하면 사라지며,
      // 그것이 이 모드의 한계다.
      'GET /assets': ({ token, params }) => {
        const user = this.requireUser(token)
        const scope = this.managedOrgIds(user)
        let items = this.assets.filter((a) => scope === null || scope.has(a.org_id))
        if (params?.kind) items = items.filter((a) => a.kind === params.kind)
        if (params?.q) items = items.filter((a) => a.filename.includes(params.q))
        return this.paginate(items.map((a) => this.publicAsset(a)), params)
      },

      'GET /assets/:id': ({ token, ids }) => {
        this.requireUser(token)
        const asset = this.assets.find((a) => a.id === ids[0])
        if (!asset) throw new ApiError(404, '파일을(를) 찾을 수 없습니다.')
        return this.publicAsset(asset)
      },

      'POST /assets': ({ token, body, params }) => {
        const user = this.requireUser(token)
        // 실제 요청은 FormData 다. 목 서버는 파일 메타만 받아 흉내 낸다.
        const file = body?.get?.('file') ?? null
        if (!file) throw new ApiError(400, '빈 파일입니다.')
        const kind = String(file.type || '').startsWith('video/') ? 'video' : 'image'
        const asset = {
          id: this.nextId.asset++,
          org_id: Number(params?.org_id) || user.org_id,
          uploaded_by: user.id,
          kind,
          filename: file.name || 'upload',
          content_type: file.type || 'application/octet-stream',
          size_bytes: file.size || 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // 테스트 모드에서만 쓰는 임시 주소.
          mock_url: typeof URL !== 'undefined' && URL.createObjectURL
            ? URL.createObjectURL(file)
            : '',
        }
        this.assets.push(asset)
        return this.publicAsset(asset)
      },

      'PUT /assets/:id': ({ token, body, ids }) => {
        this.requireUser(token)
        const asset = this.assets.find((a) => a.id === ids[0])
        if (!asset) throw new ApiError(404, '파일을(를) 찾을 수 없습니다.')
        asset.filename = body.filename
        return this.publicAsset(asset)
      },

      'DELETE /assets/:id': ({ token, ids }) => {
        this.requireUser(token)
        const asset = this.assets.find((a) => a.id === ids[0])
        if (!asset) throw new ApiError(404, '파일을(를) 찾을 수 없습니다.')
        const used = this.assetUsage(asset.id)
        if (used) {
          throw new ApiError(400, `콘텐츠 ${used}건에서 사용 중이라 삭제할 수 없습니다.`)
        }
        this.assets = this.assets.filter((a) => a.id !== asset.id)
        return { detail: '파일을 삭제했습니다.' }
      },

      'GET /playlists': ({ token, params }) => {
        const user = this.requireUser(token)
        const scope = this.managedOrgIds(user)
        let items = this.playlists.filter((p) => scope === null || scope.has(p.org_id))
        if (params?.q) items = items.filter((p) => p.name.includes(params.q))
        return this.paginate(items.map((p) => this.publicPlaylist(p)), params)
      },

      'GET /playlists/:id': ({ token, ids }) => {
        const user = this.requireUser(token)
        const playlist = this.playlists.find((p) => p.id === ids[0])
        if (!playlist) throw new ApiError(404, '재생목록을(를) 찾을 수 없습니다.')
        if (!this.canViewOrg(user, playlist.org_id)) {
          throw new ApiError(403, '해당 재생목록을 조회할 권한이 없습니다.')
        }
        return this.publicPlaylist(playlist)
      },

      'POST /playlists': ({ token, body }) => {
        const user = this.requireUser(token)
        const orgId = body.org_id ?? user.org_id
        if (!this.canViewOrg(user, orgId)) {
          throw new ApiError(403, '해당 기관에 재생목록을 만들 권한이 없습니다.')
        }
        const now = new Date().toISOString()
        const playlist = {
          id: this.nextId.playlist++,
          name: body.name,
          description: body.description ?? null,
          org_id: orgId,
          created_by: user.id,
          version: 1,
          created_at: now,
          updated_at: now,
          items: this.playlistItems(body.items ?? []),
        }
        this.playlists.push(playlist)
        return this.publicPlaylist(playlist)
      },

      'PUT /playlists/:id': ({ token, body, ids }) => {
        const user = this.requireUser(token)
        const playlist = this.ownedPlaylist(user, ids[0])
        if (body.name !== undefined) playlist.name = body.name
        if (body.description !== undefined) playlist.description = body.description
        if (body.items !== undefined) playlist.items = this.playlistItems(body.items)
        // 실제 서버와 같이 고칠 때마다 버전을 올린다. 이 값이 콘텐츠·스케줄로 번진다.
        playlist.version += 1
        playlist.updated_at = new Date().toISOString()
        return this.publicPlaylist(playlist)
      },

      'POST /playlists/:id/duplicate': ({ token, ids }) => {
        const user = this.requireUser(token)
        const source = this.playlists.find((p) => p.id === ids[0])
        if (!source) throw new ApiError(404, '재생목록을(를) 찾을 수 없습니다.')
        const now = new Date().toISOString()
        const copy = {
          ...clone(source),
          id: this.nextId.playlist++,
          name: `${source.name} (복사본)`,
          created_by: user.id,
          version: 1,
          created_at: now,
          updated_at: now,
        }
        copy.items = copy.items.map((item) => ({ ...item, id: this.nextId.playlistItem++ }))
        this.playlists.push(copy)
        return this.publicPlaylist(copy)
      },

      'DELETE /playlists/:id': ({ token, ids }) => {
        const user = this.requireUser(token)
        const playlist = this.ownedPlaylist(user, ids[0])
        const used = this.playlistUsage(playlist.id)
        if (used) {
          throw new ApiError(
            400,
            `이 재생목록을 쓰는 콘텐츠가 ${used}건 있습니다. 먼저 교체하세요.`,
          )
        }
        this.playlists = this.playlists.filter((p) => p.id !== playlist.id)
        return { detail: '재생목록이 삭제되었습니다.' }
      },

      // ------------------------------------------------------------ 스톡 소재 검색
      // 테스트 모드는 바깥으로 나가지 않는다. 키도 없고, 폐쇄망일 수도 있다.
      // 대신 편집기가 결과를 어떻게 다루는지 볼 수 있게 가짜 결과를 만든다.
      'GET /stock/status': ({ token }) => {
        this.requireUser(token)
        return { configured: true, provider: 'pixabay' }
      },

      'GET /stock/search': ({ token, params }) => {
        this.requireUser(token)
        const isVideo = params?.kind === 'video'
        const portrait = params?.orientation === 'vertical'
        const [w, h] = portrait ? [1080, 1620] : [1920, 1280]
        const items = Array.from({ length: 12 }, (_, i) => ({
          kind: isVideo ? 'video' : 'image',
          id: 9000 + i,
          // 동영상도 목록에는 그림 한 장만 그린다. 실제 제공처와 같다.
          preview: mockPhoto(`${params?.q ?? ''} ${i + 1}`, portrait, 240),
          url: mockPhoto(`${params?.q ?? ''} ${i + 1}`, portrait, 960),
          width: w,
          height: h,
          duration: isVideo ? 12 + i : null,
          tags: params?.q ?? '',
          author: '테스트',
          page: 'https://pixabay.com/',
        }))
        return { items, total: items.length, page: 1, per_page: items.length }
      },

      // 실제 서버는 소재를 내려받아 저장한다. 목 서버는 주소를 그대로
      // 들고 있는 자산을 만든다 — 편집기가 보는 결과는 같다.
      'POST /stock/save': ({ token, body }) => {
        const user = this.requireUser(token)
        if (!body?.url) throw new ApiError(400, '빈 파일입니다.')
        const kind = body.kind === 'video' ? 'video' : 'image'
        const asset = {
          id: this.nextId.asset++,
          org_id: Number(body.org_id) || user.org_id,
          uploaded_by: user.id,
          kind,
          filename: body.filename || `pixabay-${kind}`,
          content_type: kind === 'video' ? 'video/mp4' : 'image/jpeg',
          size_bytes: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          mock_url: body.url,
        }
        this.assets.push(asset)
        return this.publicAsset(asset)
      },

      // ------------------------------------------------------------ 장치그룹
      // 장치그룹은 **사용자 개인의** 묶음이다. 남의 그룹은 보이지도 고쳐지지도 않는다.
      'GET /device-groups': ({ token }) => {
        const user = this.requireUser(token)
        return this.deviceGroups
          .filter((g) => g.user_id === user.id)
          .map((g) => this.publicGroup(g))
      },

      'POST /device-groups': ({ token, body }) => {
        const user = this.requireUser(token)
        const deviceIds = this.assertGroupDevices(user, body.device_ids ?? [])

        const group = { id: this.nextId.group++, name: body.name, user_id: user.id, device_ids: deviceIds }
        this.deviceGroups.push(group)
        return this.publicGroup(group)
      },

      'PUT /device-groups/:id': ({ token, body, ids }) => {
        const user = this.requireUser(token)
        const group = this.ownedGroup(user, ids[0])

        if (body.name !== undefined) group.name = body.name
        // undefined 면 구성원을 건드리지 않는다. 빈 배열은 '전부 비우기'다.
        if (body.device_ids !== undefined) {
          group.device_ids = this.assertGroupDevices(user, body.device_ids)
        }
        return this.publicGroup(group)
      },

      'DELETE /device-groups/:id': ({ token, ids }) => {
        const user = this.requireUser(token)
        const group = this.ownedGroup(user, ids[0])
        this.deviceGroups = this.deviceGroups.filter((g) => g.id !== group.id)
        return { detail: '장치그룹이 삭제되었습니다.' }
      },

      // ------------------------------------------------------------ 스케줄
      'GET /schedules': ({ token, params }) => {
        const user = this.requireUser(token)
        const scope = this.managedOrgIds(user)
        let items = this.schedules.filter((s) => scope === null || scope.has(s.org_id))
        if (params.q) items = items.filter((s) => s.name.includes(params.q))
        return this.paginate(items.map((s) => this.publicSchedule(s)), params)
      },

      'GET /schedules/content/blank': ({ params }) => ({
        version: 1,
        layout: {
          width: Number(params.width ?? 1920),
          height: Number(params.height ?? 1080),
          background: '#000000',
        },
        elements: [],
      }),

      'GET /schedules/:id': ({ token, ids }) => {
        const user = this.requireUser(token)
        const schedule = this.schedules.find((s) => s.id === ids[0])
        if (!schedule) throw new ApiError(404, '스케줄을(를) 찾을 수 없습니다.')
        if (!this.canViewOrg(user, schedule.org_id)) {
          throw new ApiError(403, '해당 스케줄을 조회할 권한이 없습니다.')
        }
        return this.publicSchedule(schedule, { withItems: true })
      },

      'POST /schedules': ({ token, body }) => {
        const user = this.requireUser(token)
        const orgId = body.org_id ?? user.org_id
        if (!this.canViewOrg(user, orgId)) {
          throw new ApiError(403, '해당 기관에 스케줄을 만들 권한이 없습니다.')
        }
        const now = new Date().toISOString()
        const incoming = body.items ?? []
        const orientation = body.orientation ?? 'LANDSCAPE'
        this.assertContentsUsable(user, incoming)
        this.assertOrientation(incoming, orientation)
        this.assertNoOverlap(incoming)
        this.assertPeriod(body.start_at, body.end_at)

        const schedule = {
          id: this.nextId.schedule++,
          name: body.name,
          kind: body.kind ?? '시간지정',
          orientation,
          start_at: body.start_at ?? null,
          end_at: body.end_at ?? null,
          org_id: orgId,
          created_by: user.id,
          version: 1,
          created_at: now,
          updated_at: now,
          items: [],
        }
        schedule.items = this.normalizeItems(schedule, incoming)
        this.schedules.push(schedule)
        return this.publicSchedule(schedule, { withItems: true })
      },

      'PUT /schedules/:id': ({ token, body, ids }) => {
        const user = this.requireUser(token)
        const schedule = this.schedules.find((s) => s.id === ids[0])
        if (!schedule) throw new ApiError(404, '스케줄을(를) 찾을 수 없습니다.')
        if (!this.canManageOrg(user, schedule.org_id) && schedule.created_by !== user.id) {
          throw new ApiError(403, '해당 스케줄을 수정할 권한이 없습니다.')
        }
        const orientation = body.orientation ?? schedule.orientation ?? 'LANDSCAPE'
        // 검사를 먼저 끝내고 나서 바꾼다. 거부된 요청이 값을 남기면 안 된다.
        this.assertPeriod(
          body.start_at !== undefined ? body.start_at : schedule.start_at,
          body.end_at !== undefined ? body.end_at : schedule.end_at,
        )
        if (body.items !== undefined) {
          this.assertContentsUsable(user, body.items)
          this.assertOrientation(body.items, orientation)
          this.assertNoOverlap(body.items)
        } else if (orientation !== schedule.orientation) {
          // 방향만 바꾸는 경우. 이미 붙어 있는 콘텐츠가 새 방향과 맞아야 한다.
          this.assertOrientation(schedule.items, orientation)
        }
        if (body.name !== undefined) schedule.name = body.name
        if (body.kind !== undefined) schedule.kind = body.kind
        if (body.orientation !== undefined) schedule.orientation = body.orientation
        // null 은 '제한 없음'이라는 뜻이라 보내온 null 도 반영해야 한다.
        if (body.start_at !== undefined) schedule.start_at = body.start_at
        if (body.end_at !== undefined) schedule.end_at = body.end_at
        if (body.items !== undefined) {
          schedule.items = this.normalizeItems(schedule, body.items)
        }
        // 실제 서버와 같이 변경 때마다 버전을 올린다. 장치는 이 값으로 재수신을 판단한다.
        schedule.version += 1
        schedule.updated_at = new Date().toISOString()
        return this.publicSchedule(schedule, { withItems: true })
      },

      'DELETE /schedules/:id': ({ token, ids }) => {
        const user = this.requireUser(token)
        const schedule = this.schedules.find((s) => s.id === ids[0])
        if (!schedule) throw new ApiError(404, '스케줄을(를) 찾을 수 없습니다.')
        if (!this.canManageOrg(user, schedule.org_id) && schedule.created_by !== user.id) {
          throw new ApiError(403, '해당 스케줄을 삭제할 권한이 없습니다.')
        }
        const inUse = this.devices.filter((d) => (d.schedule_ids ?? []).includes(schedule.id)).length
        if (inUse) {
          throw new ApiError(400, `이 스케줄을 사용 중인 장치가 ${inUse}대 있습니다. 먼저 배정을 해제하세요.`)
        }
        this.schedules = this.schedules.filter((s) => s.id !== schedule.id)
        return { detail: '스케줄이 삭제되었습니다.' }
      },

      'POST /schedules/:id/duplicate': ({ token, ids }) => {
        const user = this.requireUser(token)
        const source = this.schedules.find((s) => s.id === ids[0])
        if (!source) throw new ApiError(404, '스케줄을(를) 찾을 수 없습니다.')
        const now = new Date().toISOString()
        const copy = {
          ...clone(source),
          id: this.nextId.schedule++,
          name: `${source.name} (복사본)`,
          created_by: user.id,
          version: 1,
          created_at: now,
          updated_at: now,
        }
        for (const item of copy.items) {
          item.id = this.nextId.item++
          item.schedule_id = copy.id
        }
        this.schedules.push(copy)
        return this.publicSchedule(copy, { withItems: true })
      },

      // ------------------------------------------------------------ 콘텐츠 라이브러리
      'GET /contents': ({ token, params }) => {
        const user = this.requireUser(token)
        const scope = this.managedOrgIds(user)
        let items = this.contents.filter((c) => scope === null || scope.has(c.org_id))
        if (params.q) items = items.filter((c) => c.name.includes(params.q))
        if (params.orientation === 'portrait') items = items.filter((c) => c.height > c.width)
        if (params.orientation === 'landscape') items = items.filter((c) => c.height <= c.width)
        if (params.org_id) {
          const sub = this.descendantIds(Number(params.org_id))
          items = items.filter((c) => sub.has(c.org_id))
        }
        const sorted = [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        return this.paginate(
          sorted.map((c) => this.contentSummary(c)),
          { page: params.page ?? 1, size: params.size ?? 24 },
        )
      },

      'GET /contents/:id': ({ token, ids }) => {
        const user = this.requireUser(token)
        const content = this.contents.find((c) => c.id === ids[0])
        if (!content) throw new ApiError(404, '콘텐츠을(를) 찾을 수 없습니다.')
        if (!this.canViewOrg(user, content.org_id)) {
          throw new ApiError(403, '해당 콘텐츠를 조회할 권한이 없습니다.')
        }
        return { ...this.contentSummary(content), document: clone(content.document) }
      },

      'POST /contents': ({ token, body }) => {
        const user = this.requireUser(token)
        const orgId = body.org_id ?? user.org_id
        if (!this.canViewOrg(user, orgId)) {
          throw new ApiError(403, '해당 기관에 콘텐츠를 만들 권한이 없습니다.')
        }
        const now = new Date().toISOString()
        const width = body.width ?? 1920
        const height = body.height ?? 1080
        const content = {
          id: this.nextId.content++,
          name: body.name,
          description: body.description ?? null,
          org_id: orgId,
          created_by: user.id,
          width,
          height,
          version: 1,
          created_at: now,
          updated_at: now,
          document: body.document ?? {
            version: 1,
            layout: { width, height, background: '#000000' },
            elements: [],
          },
        }
        this.contents.push(content)
        return { ...this.contentSummary(content), document: clone(content.document) }
      },

      'PUT /contents/:id': ({ token, body, ids }) => {
        const user = this.requireUser(token)
        const content = this.contents.find((c) => c.id === ids[0])
        if (!content) throw new ApiError(404, '콘텐츠을(를) 찾을 수 없습니다.')
        if (!this.canManageOrg(user, content.org_id) && content.created_by !== user.id) {
          throw new ApiError(403, '해당 콘텐츠를 수정할 권한이 없습니다.')
        }
        for (const field of ['name', 'description', 'width', 'height', 'document']) {
          if (body[field] !== undefined && body[field] !== null) content[field] = body[field]
        }
        content.version += 1
        content.updated_at = new Date().toISOString()

        // 이 콘텐츠를 쓰는 스케줄의 버전도 올려야 장치가 변경을 감지한다.
        for (const schedule of this.schedules) {
          if (schedule.items.some((item) => item.content_id === content.id)) {
            schedule.version += 1
            schedule.updated_at = content.updated_at
          }
        }
        return { ...this.contentSummary(content), document: clone(content.document) }
      },

      'POST /contents/:id/duplicate': ({ token, ids }) => {
        const user = this.requireUser(token)
        const source = this.contents.find((c) => c.id === ids[0])
        if (!source) throw new ApiError(404, '콘텐츠을(를) 찾을 수 없습니다.')
        if (!this.canViewOrg(user, source.org_id)) {
          throw new ApiError(403, '해당 콘텐츠를 복제할 권한이 없습니다.')
        }
        const now = new Date().toISOString()
        const copy = {
          ...clone(source),
          id: this.nextId.content++,
          name: `${source.name} (복사본)`,
          created_by: user.id,
          version: 1,
          created_at: now,
          updated_at: now,
        }
        this.contents.push(copy)
        return { ...this.contentSummary(copy), document: clone(copy.document) }
      },

      'DELETE /contents/:id': ({ token, ids }) => {
        const user = this.requireUser(token)
        const content = this.contents.find((c) => c.id === ids[0])
        if (!content) throw new ApiError(404, '콘텐츠을(를) 찾을 수 없습니다.')
        if (!this.canManageOrg(user, content.org_id) && content.created_by !== user.id) {
          throw new ApiError(403, '해당 콘텐츠를 삭제할 권한이 없습니다.')
        }
        const used = this.contentUsage(content.id)
        if (used) {
          throw new ApiError(
            400,
            `이 콘텐츠를 사용하는 스케줄 아이템이 ${used}건 있습니다. 먼저 배치를 해제하세요.`,
          )
        }
        this.contents = this.contents.filter((c) => c.id !== content.id)
        return { detail: '콘텐츠가 삭제되었습니다.' }
      },

      // ------------------------------------------------------------ 게시판/위젯
      'GET /boards': ({ token, params }) => {
        const user = this.requireUser(token)
        const orgId = params.org_id ? Number(params.org_id) : user.org_id
        if (!this.canViewOrg(user, orgId)) {
          throw new ApiError(403, '해당 기관의 게시판을 조회할 권한이 없습니다.')
        }
        return this.boards.filter((b) => b.org_id === orgId)
      },

      'GET /boards/:id/posts': ({ token, ids, params }) => {
        this.requireUser(token)
        const items = this.posts.filter((p) => p.board_id === ids[0])
        return this.paginate(items, params)
      },

      // ------------------------------------------------------------ 커뮤니티
      // 어느 커뮤니티인지는 서버가 정한다: 소속 기관에서 위로 올라가 처음
      // 만나는 '기관'. 목 서버도 같은 규칙을 쓴다.
      'PUT /auth/me': ({ token, body }) => {
        const user = this.requireUser(token)
        if (body.name != null) user.name = body.name
        if (body.phone !== undefined) user.phone = body.phone
        if (body.email !== undefined) user.email = body.email
        return this.publicUser(user)
      },

      'POST /auth/change-password': ({ token, body }) => {
        const user = this.requireUser(token)
        if (body.current_password !== user.password) {
          throw new ApiError(400, '현재 비밀번호가 올바르지 않습니다.')
        }
        user.password = body.new_password
        return { detail: '비밀번호가 변경되었습니다.' }
      },

      'GET /community/context': ({ token }) => {
        const user = this.requireUser(token)
        const org = this.communityOrgOf(user)
        if (!org) throw new ApiError(404, '커뮤니티을(를) 찾을 수 없습니다.')
        const canShare =
          user.roles.includes('COMMUNITY_USER') ||
          user.roles.includes('SUPER_ADMIN') ||
          user.roles.includes('ORG_ADMIN')
        return { org_id: org.id, org_name: org.name, can_share: canShare }
      },

      'GET /community/posts': ({ token, params }) => {
        const user = this.requireUser(token)
        const org = this.communityOrgOf(user)
        const admin =
          user.roles.includes('SUPER_ADMIN') || user.roles.includes('ORG_ADMIN')
        const items = this.communityPosts
          .filter((p) => p.org_id === org?.id)
          .slice()
          .reverse()
          .map((p) => ({ ...p, publish_status: p.publish_status ?? '대기중', can_publish: admin }))
        return this.paginate(items, params)
      },

      'PUT /community/posts/:id/status': ({ token, ids, body }) => {
        const user = this.requireUser(token)
        const admin =
          user.roles.includes('SUPER_ADMIN') || user.roles.includes('ORG_ADMIN')
        if (!admin) throw new ApiError(403, '게시 결과는 커뮤니티 소유 기관의 관리자만 설정할 수 있습니다.')
        const post = this.communityPosts.find((p) => p.id === ids[0])
        if (!post) throw new ApiError(404, '게시글을(를) 찾을 수 없습니다.')
        if (!['대기중', '게시', '게시보류'].includes(body.status)) {
          throw new ApiError(400, '게시 결과는 대기중·게시·게시보류 중 하나여야 합니다.')
        }
        post.publish_status = body.status
        return { ...post, can_publish: true }
      },

      'POST /community/posts': ({ token, body }) => {
        const user = this.requireUser(token)
        const org = this.communityOrgOf(user)
        const post = {
          id: this.nextId.communityPost++,
          org_id: org.id,
          author_id: user.id,
          author_name: user.name,
          title: body.title,
          content: body.content ?? null,
          created_at: new Date().toISOString(),
          attachments: [],
          // 글은 늘 대기중으로 시작한다. 게시 여부는 관리자가 정한다.
          publish_status: '대기중',
          can_remove: true,
          can_publish:
            user.roles.includes('SUPER_ADMIN') || user.roles.includes('ORG_ADMIN'),
        }
        this.communityPosts.push(post)
        return post
      },

      'POST /community/posts/:id/attachments': ({ token, ids, body }) => {
        const user = this.requireUser(token)
        const post = this.communityPosts.find((p) => p.id === ids[0])
        if (!post) throw new ApiError(404, '게시글을(를) 찾을 수 없습니다.')
        const asset = this.mockAssetFromForm(user, body)
        post.attachments.push(this.publicAsset(asset))
        return this.publicAsset(asset)
      },

      'DELETE /community/posts/:id': ({ token, ids }) => {
        this.requireUser(token)
        this.communityPosts = this.communityPosts.filter((p) => p.id !== ids[0])
        return { detail: '글을 지웠습니다.' }
      },

      // 게시판 글에 붙인 파일이 곧 공유 재료다 — 낱개로 편 목록.
      'GET /community/media': ({ token, params }) => {
        const user = this.requireUser(token)
        const org = this.communityOrgOf(user)
        const kind = params?.kind ?? 'image'
        const items = this.communityPosts
          .filter((p) => p.org_id === org?.id)
          .flatMap((p) =>
            (p.attachments ?? [])
              .filter((a) => a.kind === kind)
              .map((a) => ({ id: a.id, title: p.title, asset: a })),
          )
          .reverse()
        return this.paginate(items, params)
      },

      'GET /community/list': ({ token }) => {
        const user = this.requireUser(token)
        const canShare =
          user.roles.includes('COMMUNITY_USER') ||
          user.roles.includes('SUPER_ADMIN') ||
          user.roles.includes('ORG_ADMIN')
        // 슈퍼관리자는 모든 상위기관 커뮤니티를 쓴다.
        if (user.roles.includes('SUPER_ADMIN')) {
          return this.organizations
            .filter((o) => o.org_type === '기관')
            .map((o) => ({ org_id: o.id, org_name: o.name, can_share: canShare }))
        }
        const org = this.communityOrgOf(user)
        return org ? [{ org_id: org.id, org_name: org.name, can_share: canShare }] : []
      },

      'GET /community/contents': ({ token, params }) => {
        const user = this.requireUser(token)
        const orgId = params?.org_id ? Number(params.org_id) : this.communityOrgOf(user)?.id
        const items = this.communityContents
          .filter((c) => c.org_id === orgId)
          .slice()
          .reverse()
        return this.paginate(items, params)
      },

      'GET /community/contents/:id': ({ token, ids }) => {
        this.requireUser(token)
        const content = this.communityContents.find((c) => c.id === ids[0])
        if (!content) throw new ApiError(404, '커뮤니티 콘텐츠을(를) 찾을 수 없습니다.')
        return content
      },

      'POST /community/contents': ({ token, body, params }) => {
        const user = this.requireUser(token)
        const orgId = params?.org_id ? Number(params.org_id) : this.communityOrgOf(user)?.id
        const content = {
          id: this.nextId.communityContent++,
          org_id: orgId,
          author_id: user.id,
          author_name: user.name,
          title: body.title,
          version: 1,
          created_at: new Date().toISOString(),
          // CMS 콘텐츠와 같은 문서 계약. 비우면 빈 캔버스로 시작한다.
          document: body.document ?? {
            version: 1,
            layout: { width: 1920, height: 1080, background: '#000000' },
            elements: [],
          },
          element_count: (body.document?.elements ?? []).length,
          start_date: null,
          end_date: null,
          audience: '전체',
          can_remove: true,
        }
        this.communityContents.push(content)
        return content
      },

      'PUT /community/contents/:id': ({ token, ids, body }) => {
        this.requireUser(token)
        const content = this.communityContents.find((c) => c.id === ids[0])
        if (!content) throw new ApiError(404, '커뮤니티 콘텐츠을(를) 찾을 수 없습니다.')
        if (body.title !== undefined && body.title !== null) content.title = body.title
        if (body.document) {
          content.document = body.document
          content.element_count = (body.document.elements ?? []).length
        }
        // 빈 문자열은 '기간 지움'. undefined 는 '건드리지 않음' — 실제 서버와 같다.
        if (body.start_date !== undefined) content.start_date = body.start_date || null
        if (body.end_date !== undefined) content.end_date = body.end_date || null
        if (body.audience !== undefined && body.audience !== null) {
          if (!['전체', '초', '중', '고'].includes(body.audience)) {
            throw new ApiError(400, '사용대상은 전체·초·중·고 중 하나여야 합니다.')
          }
          content.audience = body.audience
        }
        content.version += 1
        return content
      },

      // -------------------------------------------------- 커뮤니티 재생목록

      'GET /community/playlists': ({ token, params }) => {
        const user = this.requireUser(token)
        const orgId = params?.org_id ? Number(params.org_id) : this.communityOrgOf(user)?.id
        const items = this.communityPlaylists
          .filter((p) => p.org_id === orgId)
          .slice()
          .reverse()
          .map((p) => this.publicCommunityPlaylist(p))
        return this.paginate(items, params)
      },

      'POST /community/playlists': ({ token, body, params }) => {
        const user = this.requireUser(token)
        const orgId = params?.org_id ? Number(params.org_id) : this.communityOrgOf(user)?.id
        const playlist = {
          id: this.nextId.communityPlaylist++,
          org_id: orgId,
          author_id: user.id,
          author_name: user.name,
          name: body.name,
          items: this.cleanCommunityPlaylistItems(orgId, body.items),
          version: 1,
          created_at: new Date().toISOString(),
          can_remove: true,
        }
        this.communityPlaylists.push(playlist)
        return this.publicCommunityPlaylist(playlist)
      },

      'PUT /community/playlists/:id': ({ token, body, ids }) => {
        this.requireUser(token)
        const playlist = this.communityPlaylists.find((p) => p.id === ids[0])
        if (!playlist) throw new ApiError(404, '커뮤니티 재생목록을(를) 찾을 수 없습니다.')
        if (body.name !== undefined && body.name !== null) playlist.name = body.name
        if (body.items) playlist.items = this.cleanCommunityPlaylistItems(playlist.org_id, body.items)
        playlist.version += 1
        return this.publicCommunityPlaylist(playlist)
      },

      'DELETE /community/playlists/:id': ({ token, ids }) => {
        this.requireUser(token)
        this.communityPlaylists = this.communityPlaylists.filter((p) => p.id !== ids[0])
        return { detail: '재생목록을 지웠습니다.' }
      },

      'DELETE /community/contents/:id': ({ token, ids }) => {
        this.requireUser(token)
        this.communityContents = this.communityContents.filter((c) => c.id !== ids[0])
        return { detail: '콘텐츠를 지웠습니다.' }
      },

      'GET /widgets': ({ token }) => {
        this.requireUser(token)
        return WIDGET_SPECS
      },

      'GET /widgets/:key/data': () => ({ key: 'mock', fetched_at: new Date().toISOString(), data: null }),
    }
  }
}

export const mockServer = new MockServer()
