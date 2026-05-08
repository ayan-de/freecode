import React from 'react'
import { Box, Text } from 'ink'
import { TextPart } from './parts/TextPart'
import { CodePart } from './parts/CodePart'
import { ToolPart } from './parts/ToolPart'

interface MessagePart {
  type: 'text' | 'code' | 'tool'
  content?: string
  language?: string
  tool?: { name: string; args: Record<string, unknown> }
  result?: string
}

interface AssistantMessageProps {
  parts: MessagePart[]
}

export const AssistantMessage: React.FC<AssistantMessageProps> = ({ parts }) => {
  return (
    <Box flexDirection="column" paddingY={1} alignItems="center">
      <Box marginBottom={1}>
        <Text color="green" bold>F</Text>
        <Text dimColor> FreeCode</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {parts.map((part, i) => {
          switch (part.type) {
            case 'text':
              return <TextPart key={i} content={part.content || ''} />
            case 'code':
              return <CodePart key={i} language={part.language || 'text'} content={part.content || ''} />
            case 'tool':
              return <ToolPart key={i} tool={part.tool!} result={part.result} />
            default:
              return null
          }
        })}
      </Box>
    </Box>
  )
}