import React, { useEffect, useRef } from 'react';
import { useChatStore } from '../stores/index.js';
import { Message } from './Message.js';

export const MessageList: React.FC = () => {
  const messages = useChatStore((state) => state.messages);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div style={{
      flex: 1,
      overflow: 'auto',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
};