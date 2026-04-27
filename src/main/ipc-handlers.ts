import { registerProjectHandlers } from './ipc/project.handlers'
import { registerCredentialHandlers } from './ipc/credential.handlers'
import { registerAppleHandlers } from './ipc/apple.handlers'
import { registerGoogleHandlers } from './ipc/google.handlers'

// Single entry point that wires every IPC channel for the renderer. Per-domain
// handlers live under ./ipc/ and each register* function calls ipcMain.handle
// at module-init time. Order doesn't matter — handlers are independent.
export function registerIpcHandlers(): void {
  registerProjectHandlers()
  registerCredentialHandlers()
  registerAppleHandlers()
  registerGoogleHandlers()
}
