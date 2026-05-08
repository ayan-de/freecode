import { useCallback, useRef } from 'react'

interface UseAutoResizeOptions {
  maxRows?: number
}

export function useAutoResize(options: UseAutoResizeOptions = {}) {
  const { maxRows = 5 } = options
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    // Reset to auto to get correct scrollHeight
    textarea.style.height = 'auto'

    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 24
    const maxHeight = lineHeight * maxRows
    const computedHeight = textarea.scrollHeight

    if (computedHeight > maxHeight) {
      textarea.style.height = `${maxHeight}px`
      textarea.style.overflow = 'auto'
    } else {
      textarea.style.height = `${computedHeight}px`
      textarea.style.overflow = 'hidden'
    }
  }, [maxRows])

  const reset = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.overflow = 'hidden'
  }, [])

  return { textareaRef, resize, reset }
}