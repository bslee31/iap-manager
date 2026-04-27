// File-picker dialog wrappers. Currently only used to read a chosen file
// (e.g. .p8 private key, JSON service-account, JSON product import) and
// return its contents to the renderer.

export function importFile(filters: { name: string; extensions: string[] }[]) {
  return window.api.importFile(filters)
}
