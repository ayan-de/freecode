import React, { useCallback, useRef, useEffect } from 'react';
import { useChatStore } from '../stores/index.js';
import { MessageList } from '../chat/MessageList.js';
import { MessageInput } from '../chat/MessageInput.js';
import { startCli, sessionStart, sessionSend } from './ipc-stub.js';

// Listen for messages from extension host
window.addEventListener('message', (event) => {
  const { type, error } = event.data;
  if (type === 'error') {
    console.error('[App] Error from extension:', error);
    useChatStore.getState().setError(error);
    useChatStore.getState().setStatus('error');
  }
});

export const App: React.FC = () => {
  const status = useChatStore((s) => s.status);
  const addMessage = useChatStore((s) => s.addMessage);
  const setStatus = useChatStore((s) => s.setStatus);
  const setError = useChatStore((s) => s.setError);
  const sessionIdRef = useRef<string | null>(null);

  // Use ref for sessionId to avoid stale closure issues
  const getSessionId = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;

    startCli();
    // Give CLI time to start (same as TUI does)
    await new Promise(resolve => setTimeout(resolve, 500));

    const session = await sessionStart({
      projectPath: '/home/ayan-de/Projects/freecode',
      provider: 'minimax',
    });
    sessionIdRef.current = session.sessionId;
    return sessionIdRef.current;
  }, []);

  const handleSend = useCallback(async (message: string) => {
    addMessage('user', [{ type: 'text', content: message }]);
    setStatus('streaming');

    try {
      const currentSessionId = await getSessionId();

      const result = await sessionSend(currentSessionId, message) as {
        success: boolean;
        message?: string;
        content?: string;
        turnCount?: number;
        iterationCount?: number;
      };

      if (result.success) {
        const response = result.content || result.message || 'Done!';
        addMessage('assistant', [{ type: 'text', content: response }]);
      } else {
        addMessage('assistant', [{ type: 'text', content: `Error: ${result.message || 'Unknown error'}` }]);
      }

      setStatus('idle');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      setStatus('error');
      console.error('[App] Error:', errorMsg);
    }
  }, [addMessage, setStatus, setError, getSessionId]);

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