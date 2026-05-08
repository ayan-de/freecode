import React, { useState, useCallback } from 'react'
import { Box, Text } from 'ink'
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

export const ChatLayout: React.FC = () => {
  const [hasStartedTyping, setHasStartedTyping] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])

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
    <Box flexDirection="column" height={process.stdout.rows || 40} paddingTop={5}>
      {/* Logo and tagline centered */}
      {!hasStartedTyping && messages.length === 0 && (
        <Box justifyContent="center" alignItems="center">
          <Logo visible={true} />
        </Box>
      )}

      {/* Prompt below logo */}
      <Box justifyContent="center" paddingTop={1}>
        <PromptInput onSubmit={handleSubmit} onTyping={() => setHasStartedTyping(true)} />
      </Box>

      {/* Messages area */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden" alignItems="center">
        {messages.map((msg) =>
          msg.role === 'user' ? (
            <UserMessage key={msg.id} content={msg.parts[0]?.content || ''} />
          ) : (
            <AssistantMessage key={msg.id} parts={msg.parts} />
          )
        )}
      </Box>
    </Box>
  )
}