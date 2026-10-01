<script setup>
/**
 * 기관 트리.
 *
 * `utils/orgTree.js` 의 `withChildCount()` 를 거친 노드를 받는다 — **모든
 * 기관**이 트리에 나온다(잎 포함). `childCount` 는 소속기관 수 배지에 쓴다.
 */
import { useI18n } from 'vue-i18n'

const { t, te } = useI18n()

/** 분류 배지 — 학교급(초/중/고)은 번역이 있고, 나머지는 값 그대로. */
function levelLabel(value) {
  const key = `enums.schoolLevel.${value}`
  return te(key) ? t(key) : value
}

defineProps({
  nodes: { type: Array, required: true },
  selectedId: { type: Number, default: null },
  depth: { type: Number, default: 0 },
})

const emit = defineEmits(['select'])
</script>

<template>
  <ul class="tree">
    <li v-for="node in nodes" :key="node.id">
      <button
        class="node"
        :class="{ selected: node.id === selectedId }"
        :style="{ paddingLeft: `${10 + depth * 16}px` }"
        @click="emit('select', node)"
      >
        <span class="node-icon">{{ node.childCount ? '📂' : '📄' }}</span>
        <span class="node-name">{{ node.name }}</span>
        <!-- 학교급 배지 — 구분 이름이 아니라 값의 존재로 판단한다(이름은 바뀔 수 있다). -->
        <span v-if="node.school_level" class="badge badge-muted">
          {{ levelLabel(node.school_level) }}
        </span>
        <span v-if="node.childCount" class="count" :title="t('org.childCount')">
          {{ node.childCount }}
        </span>
      </button>

      <OrgTree
        v-if="node.children.length"
        :nodes="node.children"
        :selected-id="selectedId"
        :depth="depth + 1"
        @select="emit('select', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
}

.node {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.node:hover {
  background: var(--surface-2);
}

.node.selected {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}

.node-icon {
  font-size: 11px;
}

.node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 소속기관 수. 이 숫자가 없으면 비어 있는 기관과 학교 200개를 가진
   기관이 접힌 상태에서 똑같아 보인다. */
.count {
  flex: none;
  min-width: 20px;
  padding: 1px 5px;
  border-radius: 9px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}

.node.selected .count {
  background: var(--surface);
  color: var(--primary);
}
</style>
