'use client'

interface TextPartProps {
  content: string
}

export function TextPart({ content }: TextPartProps) {
  return <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span>
}