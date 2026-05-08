'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Logo } from './Logo'
import { PromptInput } from './PromptInput'
import { UserMessage } from './messages/UserMessage'
import { AssistantMessage } from './messages/AssistantMessage'

interface MessagePart {
  type: 'text' | 'code' | 'tool'
  content?: string
  language?: string
  tool?: { name: string; args: Record<string, unknown> }
  result?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  parts: MessagePart[]
  timestamp: number
}

export function ChatLayout() {
  const [hasStartedTyping, setHasStartedTyping] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = useCallback((text: string) => {
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', content: text }],
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setHasStartedTyping(true)
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
      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          paddingBottom: hasStartedTyping ? '80px' : '160px',
        }}
      >
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          {messages.map((msg) =>
            msg.role === 'user' ? (
              <div key={msg.id} style={{ marginBottom: '12px' }}>
                <UserMessage content={msg.parts[0]?.content || ''} />
              </div>
            ) : (
              <div key={msg.id}>
                <AssistantMessage parts={msg.parts} />
              </div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Logo overlay */}
      <Logo visible={!hasStartedTyping && messages.length === 0} />

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