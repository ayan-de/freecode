'use client'

import { useState, useCallback } from 'react'
import { Logo } from './Logo'
import { PromptInput } from './PromptInput'

export function ChatLayout() {
  const [hasStartedTyping, setHasStartedTyping] = useState(false)

  const handleSubmit = useCallback((text: string) => {
    console.log('Prompt submitted:', text)
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0a0a0a',
      }}
    >
      {/* Messages area - takes available space */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          paddingBottom: hasStartedTyping ? '80px' : '160px',
        }}
      />

      {/* Logo overlay */}
      <Logo visible={!hasStartedTyping} />

      {/* Prompt fixed at bottom */}
      <div
        style={{
          position: hasStartedTyping ? 'relative' : 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#141414',
        }}
      >
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <PromptInput onSubmit={handleSubmit} onTyping={() => setHasStartedTyping(true)} />
        </div>
      </div>
    </div>
  )
}