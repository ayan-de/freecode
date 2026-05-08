import React, { useState } from 'react'
import { Box, Text } from 'ink'

interface CodePartProps {
  language: string
  content: string
}

export const CodePart: React.FC<CodePartProps> = ({ language, content }) => {
  const [copied, setCopied] = useState(false)

  // Ink doesn't have a copy to clipboard API, but we can show the button
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="white" padding={1} marginY={1}>
      <Box justifyContent="space-between">
        <Text dimColor>{language}</Text>
        <Text dimColor>{copied ? 'Copied!' : 'Copy'}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>{content}</Text>
      </Box>
    </Box>
  )
}