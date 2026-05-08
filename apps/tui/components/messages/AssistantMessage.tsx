'use client'

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

export function AssistantMessage({ parts }: AssistantMessageProps) {
  return (
    <div style={{ padding: '12px 0' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '8px',
        }}
      >
        <span
          style={{
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: '#22c55e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          F
        </span>
        <span style={{ color: '#6b6b6b', fontSize: '11px' }}>FreeCode</span>
      </div>
      <div style={{ fontSize: '14px', lineHeight: 1.6, color: '#e4e4e4' }}>
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
      </div>
    </div>
  )
}