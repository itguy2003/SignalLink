<script setup>
/**
 * 기관 트리.
 *
 * `utils/orgTree.js` 의 `branchNodes()` 로 가지치기한 노드를 받는다 — 잎(학교 등)은
 * 트리에 그리지 않고 오른쪽 목록이 맡는다. 그래서 자식 수는 `children.length` 가
 * 아니라 가지치기 전 값인 `childCount` 를 쓴다.
 */
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

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
        <span v-if="node.org_type === '학교' && node.school_level" class="badge badge-muted">
          {{ t(`enums.schoolLevel.${node.school_level}`) }}
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

/* 트리에 안 그리는 하위 기관이 몇 개인지 알려 준다 — 이 숫자가 없으면
   비어 있는 기관과 학교 200개를 가진 기관이 똑같아 보인다. */
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
