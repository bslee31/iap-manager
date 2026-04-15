import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Notification {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
}

export const useNotificationStore = defineStore('notification', () => {
  const notifications = ref<Notification[]>([])

  function notify(type: Notification['type'], message: string) {
    const id = crypto.randomUUID()
    notifications.value.push({ id, type, message })
    setTimeout(() => {
      notifications.value = notifications.value.filter((n) => n.id !== id)
    }, 4000)
  }

  function success(message: string) {
    notify('success', message)
  }

  function error(message: string) {
    notify('error', message)
  }

  function info(message: string) {
    notify('info', message)
  }

  return { notifications, notify, success, error, info }
})
