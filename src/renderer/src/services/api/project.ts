// Thin wrapper around the project IPC channels. Exists so renderer code
// imports a domain-named module instead of the global `window.api`, which
// keeps call sites scannable, makes mocking in tests trivial, and gives us
// a single place to add cross-cutting concerns later (logging, retries,
// error normalisation, etc.).

export function list() {
  return window.api.listProjects()
}

export function create(data: { name: string; description?: string }) {
  return window.api.createProject(data)
}

export function update(id: string, data: { name?: string; description?: string }) {
  return window.api.updateProject(id, data)
}

export function remove(id: string) {
  return window.api.deleteProject(id)
}

export function reorder(orderedIds: string[]) {
  return window.api.reorderProjects(orderedIds)
}
