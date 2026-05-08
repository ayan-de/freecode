import React from 'react'
import { Box, Text } from 'ink'

interface TextPartProps {
  content: string
}

export const TextPart: React.FC<TextPartProps> = ({ content }) => {
  return <Text>{content}</Text>
}