import React, { useEffect, useState } from 'react';
import { HELIA_API_BASE } from './chatApi';
import { helia } from './heliaTheme';
import { HeliaIcon } from './heliaIcons';
import * as Lucide from 'lucide-react';

export default function AskDoctorPanel({ open, onClose, userId, documentId, insightContext, sourceLabel }) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      setQuestions([]);
      setCopied(false);

      try {
        const body = { userId };
        if (documentId) body.documentId = documentId;
        else if (insightContext) body.insightContext = insightContext;
        else throw new Error('Nothing to generate questions from');

        const resp = await fetch(`${HELIA_API_BASE}/api/ask-doctor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
        if (!cancelled) setQuestions(Array.isArray(data.questions) ? data.questions : []);
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, userId, documentId, insightContext]);

  async function handleCopyAll() {
    if (!questions.length) return;
    const text = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Could not copy to clipboard');
    }
  }

  if (!open) return null;

  const title = sourceLabel || insightContext?.title || 'Your document';

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(44, 44, 44, 0.35)',
          zIndex: 1100,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-doctor-title"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 'min(440px, 100vw)',
          height: '100vh',
          background: helia.card,
          boxShadow: '-8px 0 32px rgba(0,0,0,0.12)',
          zIndex: 1101,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: helia.font,
        }}
      >
        <div
          style={{
            padding: '20px 22px',
            borderBottom: `1px solid ${helia.border}`,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div
              id="ask-doctor-title"
              style={{ fontWeight: 800, fontSize: 18, color: helia.forest, marginBottom: 6 }}
            >
              What should I ask my doctor?
            </div>
            <div style={{ fontSize: 13, color: helia.muted, lineHeight: 1.45 }}>{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: `1px solid ${helia.border}`,
              background: helia.cream,
              borderRadius: '50%',
              width: 36,
              height: 36,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <HeliaIcon icon={Lucide.X} size={18} color={helia.muted} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: helia.muted }}>
              <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
              Generating advocacy questions from your records…
            </div>
          ) : error ? (
            <div style={{ color: helia.alert, fontSize: 15, lineHeight: 1.5 }}>{error}</div>
          ) : questions.length === 0 ? (
            <div style={{ color: helia.muted, fontSize: 15 }}>No questions generated.</div>
          ) : (
            <>
              <p style={{ margin: '0 0 16px', fontSize: 14, color: helia.muted, lineHeight: 1.55 }}>
                Bring these to your appointment — they reference your actual records and help you advocate for yourself.
              </p>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 22,
                  display: 'grid',
                  gap: 14,
                  color: helia.body,
                  fontSize: 15,
                  lineHeight: 1.55,
                }}
              >
                {questions.map((q, idx) => (
                  <li key={idx} style={{ paddingLeft: 4 }}>
                    {q}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        <div
          style={{
            padding: '16px 22px',
            borderTop: `1px solid ${helia.border}`,
            display: 'flex',
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => void handleCopyAll()}
            disabled={!questions.length || loading}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: helia.radiusSm,
              border: 'none',
              background: !questions.length || loading ? helia.sageMuted : helia.sage,
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor: !questions.length || loading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontFamily: helia.font,
            }}
          >
            <HeliaIcon icon={Lucide.Copy} size={16} color="#fff" strokeWidth={2} />
            {copied ? 'Copied!' : 'Copy all questions'}
          </button>
        </div>
      </aside>
    </>
  );
}
