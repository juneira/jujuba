import type { ProjectSummary } from "./types.js"

function isProjectSummary(value: unknown): value is ProjectSummary {
  if (value === null || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    typeof record.name === "string" &&
    record.name !== "" &&
    typeof record.agent === "string" &&
    record.agent !== "" &&
    (record.remote === undefined || typeof record.remote === "string")
  )
}

/** Reads a registry from storage, ignoring anything that does not look like a project. */
export function parseRegistry(value: unknown): ProjectSummary[] {
  if (!Array.isArray(value)) return []
  return value.filter(isProjectSummary)
}

export function addProject(
  projects: readonly ProjectSummary[],
  project: ProjectSummary,
): ProjectSummary[] {
  if (projects.some((entry) => entry.name === project.name)) {
    throw new Error(`project ${project.name} already exists`)
  }
  if (projects.some((entry) => entry.agent === project.agent)) {
    throw new Error(`project agent ${project.agent} already exists`)
  }
  return [...projects, project]
}

export function findProject(
  projects: readonly ProjectSummary[],
  name: string,
): ProjectSummary | undefined {
  return projects.find((project) => project.name === name)
}

export function sortProjects(projects: readonly ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort((left, right) => left.name.localeCompare(right.name))
}

/** Strips credentials from a remote before showing it in the TUI. */
export function displayRemote(remote: string): string {
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)@(.*)$/i.exec(remote)
  return match === null ? remote : `${match[1]}***@${match[3]}`
}