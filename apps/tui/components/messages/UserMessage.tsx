'use client'

import { TextPart } from './parts/TextPart'

interface MessagePart {
  type: 'text' | 'code' | 'tool'
  content?: string
  language?: string
  tool?: { name: string; args: Record<string, unknown> }
  result?: string
}

interface UserMessageProps {
  content: string
}

export function UserMessage({ content }: UserMessageProps) {
  return (
    <div
      style={{
        padding: '12px 16px',
        background: '#1e1e1e',
        borderRadius: '8px',
        border: '1px solid #2a2a2a',
      }}
    >
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
            background: '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          U
        </span>
        <span style={{ color: '#6b6b6b', fontSize: '11px' }}>You</span>
      </div>
      <div style={{ fontSize: '14px', lineHeight: 1.6, color: '#e4e4e4' }}>
        <TextPart content={content} />
      </div>
    </div>
  )
}