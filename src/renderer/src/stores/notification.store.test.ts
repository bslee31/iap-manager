import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNotificationStore } from './notification.store'

describe('useNotificationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts empty', () => {
    const store = useNotificationStore()
    expect(store.notifications).toEqual([])
  })

  it('appends a notification with a generated id and the right type', () => {
    const store = useNotificationStore()
    store.success('saved')
    expect(store.notifications).toHaveLength(1)
    expect(store.notifications[0].type).toBe('success')
    expect(store.notifications[0].message).toBe('saved')
    expect(typeof store.notifications[0].id).toBe('string')
    expect(store.notifications[0].id.length).toBeGreaterThan(0)
  })

  it('supports success/error/info shorthand', () => {
    const store = useNotificationStore()
    store.success('a')
    store.error('b')
    store.info('c')
    expect(store.notifications.map((n) => n.type)).toEqual(['success', 'error', 'info'])
  })

  it('auto-dismisses each notification after 4s', () => {
    const store = useNotificationStore()
    store.notify('info', 'one')
    store.notify('info', 'two')

    expect(store.notifications).toHaveLength(2)
    vi.advanceTimersByTime(3999)
    expect(store.notifications).toHaveLength(2)
    vi.advanceTimersByTime(2)
    expect(store.notifications).toHaveLength(0)
  })

  it('dismisses each notification independently when added at different times', () => {
    const store = useNotificationStore()
    store.notify('info', 'first')
    vi.advanceTimersByTime(2000)
    store.notify('info', 'second')

    // First should expire 2s before second.
    vi.advanceTimersByTime(2000)
    expect(store.notifications.map((n) => n.message)).toEqual(['second'])
    vi.advanceTimersByTime(2000)
    expect(store.notifications).toHaveLength(0)
  })

  it('gives each notification a unique id', () => {
    const store = useNotificationStore()
    store.success('a')
    store.success('b')
    store.success('c')
    const ids = store.notifications.map((n) => n.id)
    expect(new Set(ids).size).toBe(3)
  })
})
