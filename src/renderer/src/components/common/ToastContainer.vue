<script setup lang="ts">
import { useNotificationStore } from '../../stores/notification.store'

const store = useNotificationStore()

function bgColor(type: string) {
  switch (type) {
    case 'success':
      return 'bg-green-500'
    case 'error':
      return 'bg-red-500'
    default:
      return 'bg-blue-500'
  }
}
</script>

<template>
  <div class="fixed top-4 right-4 z-50 space-y-2">
    <transition-group name="toast">
      <div
        v-for="n in store.notifications"
        :key="n.id"
        :class="bgColor(n.type)"
        class="max-w-xs rounded-lg px-4 py-2 text-sm text-white shadow-lg"
      >
        {{ n.message }}
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-enter-active {
  transition: all 0.3s ease;
}
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(30px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(30px);
}
</style>
