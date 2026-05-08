'use client'

import { useState } from 'react'

interface CodePartProps {
  language: string
  content: string
}

export function CodePart({ language, content }: CodePartProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      style={{
        margin: '8px 0',
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid #2a2a2a',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 12px',
          background: '#1e1e1e',
          borderBottom: '1px solid #2a2a2a',
        }}
      >
        <span style={{ color: '#6b6b6b', fontSize: '11px' }}>{language}</span>
        <button
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            color: copied ? '#22c55e' : '#6b6b6b',
            fontSize: '11px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '12px',
          background: '#0a0a0a',
          overflow: 'auto',
          fontSize: '13px',
          lineHeight: 1.5,
          color: '#e4e4e4',
        }}
      >
        <code>{content}</code>
      </pre>
    </div>
  )
}