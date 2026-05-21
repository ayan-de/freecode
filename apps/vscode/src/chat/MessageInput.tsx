import React, { useState, useCallback } from 'react';

interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export const MessageInput: React.FC<MessageInputProps> = ({ onSend, disabled }) => {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(() => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div style={{
      padding: '12px 16px',
      borderTop: '1px solid #404040',
      background: '#1e1e1e'
    }}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Type your message... (Cmd+Enter to send)"
        style={{
          width: '100%',
          minHeight: '60px',
          padding: '8px 12px',
          borderRadius: '4px',
          border: '1px solid #404040',
          background: '#2d2d2d',
          color: '#d4d4d4',
          fontSize: '14px',
          fontFamily: 'inherit',
          resize: 'none',
          outline: 'none'
        }}
      />
      <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          style={{
            padding: '6px 16px',
            borderRadius: '4px',
            border: 'none',
            background: disabled ? '#404040' : '#0e639c',
            color: '#fff',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: '13px'
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};