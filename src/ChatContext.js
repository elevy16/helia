import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);

  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => setIsOpen(false), []);
  const toggleChat = useCallback(() => setIsOpen((v) => !v), []);

  const value = useMemo(
    () => ({ isOpen, openChat, closeChat, toggleChat }),
    [isOpen, openChat, closeChat, toggleChat]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatPanel() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatPanel must be used within ChatProvider');
  return ctx;
}
