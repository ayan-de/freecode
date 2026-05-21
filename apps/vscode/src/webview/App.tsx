import React, { useCallback } from 'react';
import { useChatStore } from '../stores/index.js';
import { MessageList } from '../chat/MessageList.js';
import { MessageInput } from '../chat/MessageInput.js';
import { startCli, listTools, callTool } from '../ipc/client.js';

export const App: React.FC = () => {
  const status = useChatStore((s) => s.status);
  const addMessage = useChatStore((s) => s.addMessage);
  const setStatus = useChatStore((s) => s.setStatus);
  const setError = useChatStore((s) => s.setError);

  const handleSend = useCallback(async (message: string) => {
    addMessage('user', [{ type: 'text', content: message }]);
    setStatus('streaming');

    try {
      startCli();
      const tools = await listTools();

      addMessage('assistant', [{
        type: 'text',
        content: `Connected to CLI. Found ${tools.length} tools.`
      }]);

      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }, [addMessage, setStatus, setError]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#1e1e1e',
      color: '#d4d4d4'
    }}>
      <div style={{
        padding: '8px 16px',
        background: '#2d2d2d',
        borderBottom: '1px solid #404040',
        fontWeight: 500
      }}>
        FreeCode Chat
      </div>
      <MessageList />
      <MessageInput onSend={handleSend} disabled={status === 'streaming'} />
    </div>
  );
};