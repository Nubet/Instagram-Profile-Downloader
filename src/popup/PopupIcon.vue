<script setup lang="ts">
const props = defineProps<{
  name: 'settings' | 'loader' | 'stop' | 'check' | 'download' | 'chevron-down'
  class?: string
}>()

const paths = {
  'settings': [
    'M4 6h16',
    'M4 18h16',
    'M10 6a2 2 0 1 1-4 0a2 2 0 0 1 4 0Z',
    'M18 18a2 2 0 1 1-4 0a2 2 0 0 1 4 0Z',
  ],
  'stop': [
    'M8.25 8.25h7.5v7.5h-7.5z',
  ],
  'check': [
    'm5 12 4 4L19 7',
  ],
  'download': [
    'M12 3v11.25',
    'm7.5-3.75-7.5 7.5-7.5-7.5',
    'M4.5 19.5h15',
  ],
  'chevron-down': [
    'm6 9 6 6 6-6',
  ],
} as const
</script>

<template>
  <span v-if="name === 'loader'" :class="props.class" class="inline-block h-[1em] w-[1em] rounded-full border-[2px] border-current border-r-transparent animate-spin" />
  <svg
    v-else
    :class="props.class"
    class="inline-block h-[1em] w-[1em]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="path in paths[name]" :key="path" :d="path" />
  </svg>
</template>
