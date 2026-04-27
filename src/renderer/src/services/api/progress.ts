// Subscription wrappers for the long-running pipeline progress channels
// (sync / export / import). Each helper returns the unsubscribe function
// produced by the preload bridge so callers can call it from onUnmounted
// or onBeforeUnmount without keeping references to ipcRenderer themselves.

export interface ProgressEvent {
  current: number
  total: number
  phase: string
}

export function onSync(callback: (e: ProgressEvent) => void): () => void {
  return window.api.onSyncProgress(callback)
}

export function onExport(callback: (e: ProgressEvent) => void): () => void {
  return window.api.onExportProgress(callback)
}

export function onImport(callback: (e: ProgressEvent) => void): () => void {
  return window.api.onImportProgress(callback)
}
