import React from 'react'
import { Box, Text } from 'ink'

interface ToolPartProps {
  tool: { name: string; args: Record<string, unknown> }
  result?: string
}

const toolColors: Record<string, string> = {
  Read: 'blue',
  Write: 'green',
  Edit: 'yellow',
  Shell: 'red',
  Glob: 'magenta',
  Grep: 'cyan',
}

export const ToolPart: React.FC<ToolPartProps> = ({ tool, result }) => {
  const color = toolColors[tool.name] || 'white'

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} padding={1} marginY={1}>
      <Box alignItems="center" gap={1}>
        <Text bold color={color}>●</Text>
        <Text bold color={color}>{tool.name}</Text>
      </Box>
      {tool.args && Object.keys(tool.args).length > 0 && (
        <Box marginLeft={2} marginTop={1}>
          <Text dimColor>{JSON.stringify(tool.args)}</Text>
        </Box>
      )}
      {result && (
        <Box marginTop={1} padding={1} backgroundColor="black">
          <Text dimColor>{result}</Text>
        </Box>
      )}
    </Box>
  )
}