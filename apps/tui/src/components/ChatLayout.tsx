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
    <Box flexDirection="column" height={process.stdout.rows || 40}>
      {/* Messages area */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        {messages.map((msg) =>
          msg.role === 'user' ? (
            <UserMessage key={msg.id} content={msg.parts[0]?.content || ''} />
          ) : (
            <AssistantMessage key={msg.id} parts={msg.parts} />
          )
        )}
      </Box>

      {/* Logo overlay */}
      {!hasStartedTyping && messages.length === 0 && (
        <Box position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center">
          <Logo visible={true} />
        </Box>
      )}

      {/* Prompt at bottom */}
      <Box>
        <PromptInput onSubmit={handleSubmit} onTyping={() => setHasStartedTyping(true)} />
      </Box>
    </Box>
  )
}