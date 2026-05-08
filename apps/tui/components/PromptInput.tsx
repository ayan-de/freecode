'use client'

import { useState, useCallback, KeyboardEvent } from 'react'
import { useAutoResize } from '../hooks/useAutoResize'

interface PromptInputProps {
  onSubmit: (text: string) => void
  onTyping?: () => void
}

export function PromptInput({ onSubmit, onTyping }: PromptInputProps) {
  const [value, setValue] = useState('')
  const { textareaRef, resize, reset } = useAutoResize({ maxRows: 5 })

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value
      setValue(text)
      resize()
      if (text.length > 0 && onTyping) {
        onTyping()
      }
    },
    [resize, onTyping]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const trimmed = value.trim()
        if (trimmed) {
          onSubmit(trimmed)
          setValue('')
          reset()
        }
      }
    },
    [value, onSubmit, reset]
  )

  return (
    <div
      style={{
        padding: '12px 16px',
        borderTop: '1px solid #2a2a2a',
        background: '#141414',
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Ask FreeCode to help with your code..."
        rows={1}
        style={{
          width: '100%',
          background: '#1e1e1e',
          border: '1px solid #2a2a2a',
          borderRadius: '6px',
          padding: '10px 14px',
          color: '#e4e4e4',
          fontSize: '14px',
          fontFamily: 'inherit',
          resize: 'none',
          outline: 'none',
          lineHeight: 1.5,
          minHeight: '42px',
          overflow: 'hidden',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = '#3b82f6'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = '#2a2a2a'
        }}
      />
    </div>
  )
}