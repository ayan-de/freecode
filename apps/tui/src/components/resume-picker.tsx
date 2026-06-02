// =============================================================================
// Resume Picker - Session selection component for resuming previous sessions
// =============================================================================

import { SelectList, type SelectItem, type SelectListTheme } from "@earendil-works/pi-tui"

// SessionMeta interface (matching the core session store)
export interface SessionMeta {
  id: string
  title: string
  projectPath: string
  provider: string
  model?: string
  status: 'active' | 'interrupted' | 'archived' | 'deleted'
  createdAt: number
  updatedAt: number
  lastTurnAt: number
  turnCount: number
  parentId?: string
  aggregatedTokenCount?: number
}

export interface ResumePickerCallbacks {
  onSelect: (sessionId: string) => void
  onCancel: () => void
}

export function createResumePicker(
  sessions: SessionMeta[],
  callbacks: ResumePickerCallbacks,
  theme?: SelectListTheme
): { component: SelectList; cleanup: () => void } {
  const items: SelectItem[] = sessions.map((s) => ({
    label: `${s.title} (${s.projectPath})`,
    value: s.id,
    description: `${s.turnCount} turns \u2022 ${formatRelativeTime(s.lastTurnAt)}${s.status === 'interrupted' ? ' [Interrupted]' : ''}`,
  }))

  const picker = new SelectList(items, Math.min(items.length, 10), theme ?? defaultSelectListTheme)

  picker.onSelect = async (item: SelectItem) => {
    callbacks.onSelect(item.value)
  }

  picker.onCancel = () => {
    callbacks.onCancel()
  }

  return {
    component: picker,
    cleanup: () => {
      /* nothing to cleanup */
    },
  }
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const defaultSelectListTheme: SelectListTheme = {
  selectedPrefix: (text) => `> ${text}`,
  selectedText: (text) => text,
  description: (text) => text,
  scrollInfo: (text) => text,
  noMatch: (text) => text,
}