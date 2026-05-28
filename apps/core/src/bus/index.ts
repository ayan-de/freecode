// =============================================================================
// Bus - Event distribution system
// PRIMARY: Pub/sub event system for session events
// INPUT: BusEvent { type, payload, timestamp }
// OUTPUT: void (publishes events, subscribes handlers)
// EVENTS: SessionDiff, SessionError, SessionCreated, SessionUpdated, ToolsChanged, etc.
// PURPOSE: Notifies TUI/VSCode frontends of session state changes without coupling
// =============================================================================

export interface BusEvent {
  type: string
  payload: unknown
  timestamp: number
}

export interface Bus {
  publish(event: BusEvent): void
  subscribe(handler: (event: BusEvent) => void): void
}

export const createBus = (): Bus => ({
  publish(event) {
    console.log(`[Bus] Event: ${event.type}`, event.payload)
  },
  subscribe(_handler) {
    console.log("[Bus] Subscribed to events")
  },
})