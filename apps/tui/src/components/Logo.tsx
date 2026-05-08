import React from 'react'
import { Box, Text } from 'ink'
import { logoLines, logoTagline } from '../assets/logo'

interface LogoProps {
  visible: boolean
}

export const Logo: React.FC<LogoProps> = ({ visible }) => {
  if (!visible) return null

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height={12}>
      <Box>
        <Text bold color="blue">{logoLines[0]}</Text>
      </Box>
      {logoLines.slice(1).map((line, i) => (
        <Text key={i} bold color="blue">{line}</Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor>{logoTagline}</Text>
      </Box>
    </Box>
  )
}