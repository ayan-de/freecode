'use client'

interface ToolPartProps {
  tool: { name: string; args: Record<string, unknown> }
  result?: string
}

const toolColors: Record<string, string> = {
  Read: '#3b82f6',
  Write: '#22c55e',
  Edit: '#f59e0b',
  Shell: '#ef4444',
  Glob: '#a855f7',
  Grep: '#ec4899',
}

export function ToolPart({ tool, result }: ToolPartProps) {
  const color = toolColors[tool.name] || '#6b6b6b'

  return (
    <div
      style={{
        margin: '8px 0',
        padding: '10px 12px',
        borderRadius: '6px',
        border: `1px solid ${color}30`,
        background: `${color}10`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: color,
          }}
        />
        <span style={{ color, fontSize: '12px', fontWeight: 600 }}>{tool.name}</span>
      </div>
      {tool.args && Object.keys(tool.args).length > 0 && (
        <div style={{ color: '#a3a3a3', fontSize: '12px', marginLeft: '16px' }}>
          {JSON.stringify(tool.args)}
        </div>
      )}
      {result && (
        <pre
          style={{
            margin: '8px 0 0 0',
            padding: '8px',
            background: '#0a0a0a',
            borderRadius: '4px',
            fontSize: '12px',
            color: '#e4e4e4',
            overflow: 'auto',
            maxHeight: '200px',
          }}
        >
          {result}
        </pre>
      )}
    </div>
  )
}