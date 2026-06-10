import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { supabase } from './supabaseClient';
import { parseSummaryMarkdown } from './markdownSummary';
import { useChatPanel } from './ChatContext';
import { HELIA_API_BASE, formatSessionListDate, streamChatFromApi } from './chatApi';
import { helia } from './heliaTheme';
import { MessageCircle } from './heliaIcons';

export default function FloatingChat({ user }) {
  const { isOpen, openChat, closeChat } = useChatPanel();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState('');
  const [chatSessions, setChatSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const chatHistoryRef = useRef(null);

  useLayoutEffect(() => {
    const el = chatHistoryRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isOpen]);

  useEffect(() => {
    if (user?.id && isOpen) initChatSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isOpen]);

  async function loadMessagesForSession(sessionId) {
    if (!user?.id || !sessionId) return;
    setConversationLoading(true);
    setConversationError('');
    try {
      const url = `${HELIA_API_BASE}/api/chat-sessions/${sessionId}/messages?userId=${encodeURIComponent(user.id)}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Could not load messages: ${resp.status}`);
      const data = await resp.json();
      const rows = Array.isArray(data.messages) ? data.messages : [];
      setMessages(
        rows.map((r) => ({ id: r.id, role: r.role, content: r.content, created_at: r.created_at }))
      );
    } catch (err) {
      setConversationError(err.message || String(err));
      setMessages([]);
    } finally {
      setConversationLoading(false);
    }
  }

  async function initChatSessions() {
    if (!user?.id) return;
    setSessionsLoading(true);
    setConversationError('');
    try {
      const resp = await fetch(`${HELIA_API_BASE}/api/chat-sessions/${user.id}`);
      if (!resp.ok) throw new Error(`Could not load conversations: ${resp.status}`);
      const data = await resp.json();
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      setChatSessions(sessions);
      if (sessions.length > 0 && !activeSessionId) {
        setActiveSessionId(sessions[0].id);
        await loadMessagesForSession(sessions[0].id);
      }
    } catch (err) {
      setConversationError(err.message || String(err));
      setChatSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }

  function handleNewChat() {
    setActiveSessionId(null);
    setMessages([]);
    setConversationError('');
  }

  async function handleSendChat() {
    if (!input.trim() || !user?.id) return;
    const userId = user.id;
    const content = input.trim();
    setInput('');
    setSending(true);

    try {
      let sessionId = activeSessionId;
      if (!sessionId) {
        const createRes = await fetch(`${HELIA_API_BASE}/api/chat-sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, firstMessage: content }),
        });
        if (!createRes.ok) throw new Error(await createRes.text());
        const created = await createRes.json();
        sessionId = created.session?.id;
        if (!sessionId) throw new Error('Invalid session response');
        setActiveSessionId(sessionId);
        setChatSessions((prev) => [created.session, ...prev.filter((s) => s.id !== sessionId)]);
      }

      const { data: insertedUser, error: insertErr } = await supabase
        .from('conversations')
        .insert([{ user_id: userId, role: 'user', content, session_id: sessionId }])
        .select()
        .single();
      if (insertErr) throw new Error(insertErr.message);

      const userMsgRecord = insertedUser
        ? { id: insertedUser.id, role: 'user', content: insertedUser.content, created_at: insertedUser.created_at }
        : { role: 'user', content, created_at: new Date().toISOString() };

      const conversationForApi = [...messages, userMsgRecord];

      flushSync(() => {
        setMessages((prev) => [
          ...prev,
          userMsgRecord,
          { role: 'assistant', content: '', created_at: new Date().toISOString(), _streaming: true },
        ]);
      });

      const fullReply = await streamChatFromApi(conversationForApi, userId, (delta) => {
        setMessages((prev) => {
          const next = [...prev];
          let i = next.length - 1;
          while (i >= 0 && next[i].role !== 'assistant') i -= 1;
          if (i < 0) return prev;
          next[i] = { ...next[i], content: (next[i].content || '') + delta };
          return next;
        });
      });

      const trimmed = (fullReply || '').trim();
      if (trimmed) {
        const { data: insertedAssistant, error: assistantErr } = await supabase
          .from('conversations')
          .insert([{ user_id: userId, role: 'assistant', content: trimmed, session_id: sessionId }])
          .select()
          .single();
        if (assistantErr) setConversationError(assistantErr.message);
        else if (insertedAssistant) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next.length - 1;
            if (next[last]?.role === 'assistant') {
              next[last] = {
                id: insertedAssistant.id,
                role: 'assistant',
                content: insertedAssistant.content,
                created_at: insertedAssistant.created_at,
              };
            }
            return next;
          });
        }
      } else {
        setConversationError('No response from AI.');
        setMessages((prev) => {
          const next = [...prev];
          if (next[next.length - 1]?.role === 'assistant' && !next[next.length - 1].content?.trim()) next.pop();
          return next;
        });
      }
    } catch (err) {
      setConversationError('AI error: ' + (err.message || err));
    } finally {
      setSending(false);
    }
  }

  if (!user) return null;

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={openChat}
          aria-label="Chat with Helia"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 58,
            height: 58,
            borderRadius: '50%',
            background: helia.sage,
            color: '#fff',
            border: 'none',
            boxShadow: '0 4px 20px rgba(45, 90, 39, 0.35)',
            cursor: 'pointer',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.15s ease',
          }}
          className="helia-fab"
        >
          <MessageCircle size={26} color="#fff" strokeWidth={2} aria-hidden />
        </button>
      )}

      {isOpen && (
        <div
          role="presentation"
          onClick={closeChat}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(44, 44, 44, 0.35)',
            zIndex: 1001,
          }}
        />
      )}

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          right: 0,
          left: 0,
          height: isOpen ? '65vh' : 0,
          background: helia.card,
          borderTopLeftRadius: helia.radius,
          borderTopRightRadius: helia.radius,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
          zIndex: 1002,
          display: 'flex',
          flexDirection: 'column',
          transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.28s ease, height 0.28s ease',
          overflow: 'hidden',
          maxWidth: 920,
          margin: '0 auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: `1px solid ${helia.border}`,
            flexShrink: 0,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18, color: helia.forest }}>Chat with Helia</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleNewChat}
              style={{
                padding: '8px 12px',
                borderRadius: helia.radiusSm,
                border: `1px solid ${helia.border}`,
                background: helia.cream,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
                color: helia.forest,
              }}
            >
              New chat
            </button>
            <button
              type="button"
              onClick={closeChat}
              aria-label="Close chat"
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: `1px solid ${helia.border}`,
                background: helia.cream,
                cursor: 'pointer',
                fontSize: 18,
                color: helia.muted,
              }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <aside
            style={{
              width: 200,
              flexShrink: 0,
              borderRight: `1px solid ${helia.border}`,
              overflowY: 'auto',
              padding: 10,
              display: isOpen ? 'block' : 'none',
            }}
          >
            {sessionsLoading ? (
              <div style={{ color: helia.muted, fontSize: 13, padding: 8 }}>Loading…</div>
            ) : chatSessions.length === 0 ? (
              <div style={{ color: helia.muted, fontSize: 13, padding: 8 }}>No saved chats</div>
            ) : (
              chatSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setActiveSessionId(s.id);
                    loadMessagesForSession(s.id);
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 10px',
                    marginBottom: 6,
                    borderRadius: helia.radiusSm,
                    border: `1px solid ${activeSessionId === s.id ? helia.sage : helia.border}`,
                    background: activeSessionId === s.id ? helia.sageMuted : helia.cream,
                    cursor: 'pointer',
                    fontFamily: helia.font,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: helia.forest, lineHeight: 1.3 }}>
                    {(s.title || 'Conversation').slice(0, 40)}
                  </div>
                  <div style={{ fontSize: 11, color: helia.muted, marginTop: 4 }}>
                    {formatSessionListDate(s.created_at)}
                  </div>
                </button>
              ))
            )}
          </aside>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div
              ref={chatHistoryRef}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {conversationLoading ? (
                <div style={{ color: helia.muted, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
                  Loading…
                </div>
              ) : conversationError ? (
                <div style={{ color: helia.alert }}>{conversationError}</div>
              ) : messages.length === 0 ? (
                <div style={{ color: helia.muted, fontSize: 15 }}>
                  Ask about your documents, medications, or any health question.
                </div>
              ) : null}

              {messages.map((m, idx) => (
                <div
                  key={m.id != null ? String(m.id) : `msg-${idx}`}
                  style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}
                >
                  <div
                    style={{
                      maxWidth: '82%',
                      padding: '12px 16px',
                      borderRadius: helia.radius,
                      background:
                        m.role === 'user' ? `linear-gradient(145deg, ${helia.sage}, ${helia.forest})` : helia.cream,
                      color: m.role === 'user' ? '#fff' : helia.body,
                      border: m.role === 'user' ? 'none' : `1px solid ${helia.border}`,
                    }}
                  >
                    <div style={{ fontSize: 15, lineHeight: 1.5 }}>
                      {m.role === 'assistant' && !m._streaming
                        ? parseSummaryMarkdown((m.content || '').toString(), `chat-${m.id ?? idx}`)
                        : m.content}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                padding: '14px 20px',
                borderTop: `1px solid ${helia.border}`,
                display: 'flex',
                gap: 10,
                flexShrink: 0,
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!sending) void handleSendChat();
                  }
                }}
                placeholder="Ask Helia anything…"
                disabled={sending}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  borderRadius: helia.radiusSm,
                  border: `1px solid ${helia.border}`,
                  background: helia.cream,
                  fontSize: 16,
                  fontFamily: helia.font,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => void handleSendChat()}
                disabled={sending || !input.trim()}
                style={{
                  padding: '12px 20px',
                  background: sending || !input.trim() ? helia.sageMuted : helia.sage,
                  color: '#fff',
                  border: 'none',
                  borderRadius: helia.radiusSm,
                  fontWeight: 700,
                  cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
