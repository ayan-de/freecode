// =============================================================================
// Rollout History - Read events from disk
// PRIMARY: Load and query event history from JSONL files
// =============================================================================

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type { RolloutEvent } from "./types.js"

export interface SessionEvents {
  sessionId: string
  events: RolloutEvent[]
  startTime: number
  endTime: number
}

/**
 * Get the rollout directory for a session
 */
export function getRolloutDir(sessionId: string): string {
  return path.join(os.homedir(), ".freecode", "rollout", "sessions", sessionId)
}

/**
 * Get the events file path for a session
 */
export function getEventsFilePath(sessionId: string): string {
  return path.join(getRolloutDir(sessionId), "events.jsonl")
}

/**
 * Check if a session has recorded events
 */
export function hasRecordedEvents(sessionId: string): boolean {
  const eventsPath = getEventsFilePath(sessionId)
  return fs.existsSync(eventsPath)
}

/**
 * Load all events for a session from disk
 */
export function loadSessionEvents(sessionId: string): SessionEvents | null {
  const eventsPath = getEventsFilePath(sessionId)

  if (!fs.existsSync(eventsPath)) {
    return null
  }

  const content = fs.readFileSync(eventsPath, "utf-8")
  const lines = content.split("\n").filter((line) => line.trim())

  const events: RolloutEvent[] = []
  let startTime = Date.now()
  let endTime = 0

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as RolloutEvent
      events.push(event)
      if (event.timestamp < startTime) startTime = event.timestamp
      if (event.timestamp > endTime) endTime = event.timestamp
    } catch {
      // Skip malformed lines
    }
  }

  return {
    sessionId,
    events,
    startTime,
    endTime: endTime || Date.now(),
  }
}

/**
 * Get events by type for a session
 */
export function getEventsByType(sessionId: string, eventType: RolloutEvent["type"]): RolloutEvent[] {
  const session = loadSessionEvents(sessionId)
  if (!session) return []
  return session.events.filter((e) => e.type === eventType)
}

/**
 * Get all function calls for a session
 */
export function getFunctionCalls(sessionId: string): RolloutEvent[] {
  return getEventsByType(sessionId, "function.call")
}

/**
 * Get all function outputs for a session
 */
export function getFunctionOutputs(sessionId: string): RolloutEvent[] {
  return getEventsByType(sessionId, "function.output")
}

/**
 * Get event count for a session
 */
export function getEventCount(sessionId: string): number {
  const session = loadSessionEvents(sessionId)
  return session?.events.length ?? 0
}

/**
 * List all recorded sessions
 */
export function listRecordedSessions(): string[] {
  const sessionsDir = path.join(os.homedir(), ".freecode", "rollout", "sessions")

  if (!fs.existsSync(sessionsDir)) {
    return []
  }

  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
}

/**
 * Delete recorded session events
 */
export function deleteSessionEvents(sessionId: string): void {
  const eventsPath = getEventsFilePath(sessionId)
  const dir = getRolloutDir(sessionId)

  if (fs.existsSync(eventsPath)) {
    fs.unlinkSync(eventsPath)
  }
  if (fs.existsSync(dir)) {
    fs.rmdirSync(dir, { recursive: true })
  }
}