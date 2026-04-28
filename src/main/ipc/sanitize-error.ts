import { is } from '@electron-toolkit/utils'

// Convert an arbitrary thrown value into a user-facing string suitable for
// returning across the IPC boundary. Always logs the full error to the main-
// process console for diagnosis. In production builds, scrubs absolute file
// paths from the message so that distributed apps don't leak the user's
// home directory or our credentials path.
//
// We deliberately keep the original Error.message in dev so the developer
// sees actionable failures (Apple/Google API messages, SQL constraints,
// etc.) without juggling consoles. The threat we're guarding against is
// shipped builds echoing internal paths back to a UI screenshot.
export function sanitizeError(e: unknown): string {
  let message: string
  if (e instanceof Error) {
    console.error(e)
    message = e.message
  } else {
    console.error('Non-Error thrown:', e)
    message = String(e)
  }
  return is.dev ? message : scrubPaths(message)
}

function scrubPaths(msg: string): string {
  return msg
    .replace(/\/Users\/[^\s)'"]+/g, '<path>')
    .replace(/\/home\/[^\s)'"]+/g, '<path>')
    .replace(/[A-Z]:\\[^\s)'"]+/g, '<path>')
}
