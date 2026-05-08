import React from 'react'
import { Box, Text } from 'ink'

interface UserMessageProps {
  content: string
}

export const UserMessage: React.FC<UserMessageProps> = ({ content }) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" padding={1} marginY={1} alignItems="center">
      <Box marginBottom={1}>
        <Text color="blue" bold>U</Text>
        <Text dimColor> You</Text>
      </Box>
      <Text>{content}</Text>
    </Box>
  )
}