import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'

interface Key {
  return?: boolean
  backspace?: boolean
  delete?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  upArrow?: boolean
  downArrow?: boolean
  escape?: boolean
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

interface PromptInputProps {
  onSubmit: (text: string) => void
  onTyping?: () => void
}

export const PromptInput: React.FC<PromptInputProps> = ({ onSubmit, onTyping }) => {
  const [value, setValue] = useState('')
  const [cursorVisible, setCursorVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((v) => !v)
    }, 500)
    return () => clearInterval(interval)
  }, [])

  useInput((input: string, key: Key) => {
    if (key.return) {
      const trimmed = value.trim()
      if (trimmed) {
        onSubmit(trimmed)
        setValue('')
      }
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1))
    } else if (input) {
      setValue((v) => v + input)
      if (input && onTyping) {
        onTyping()
      }
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="black" padding={1} justifyContent="center" width={80}>
      <Text wrap="truncate-end">
        {value ? (
          <>
            {value}
            {cursorVisible && <Text bold>|</Text>}
          </>
        ) : (
          <>
            {cursorVisible && <Text dimColor bold>|</Text>}
            <Text dimColor> Ask FreeCode to help with your code...</Text>
          </>
        )}
      </Text>
      {value && (
        <Box marginTop={1}>
          <Text dimColor>Press Enter to submit</Text>
        </Box>
      )}
    </Box>
  )
}