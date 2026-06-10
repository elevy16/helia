import React, { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { parseSummaryMarkdown } from './markdownSummary';
import HeliaPageHeader from './HeliaPageHeader';
import { HELIA_API_BASE } from './chatApi';
import { helia } from './heliaTheme';
import { heliaCardStyle, heliaPageMainStyle } from './heliaUi';

function formatGeneratedAt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function HealthNarrative() {
  const { user: ctxUser } = useOutletContext() || {};
  const [user, setUser] = useState(ctxUser || null);
  const [narrative, setNarrative] = useState('');
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ctxUser) {
      setUser(ctxUser);
      return;
    }
    supabase.auth.getUser().then(({ data }) => setUser(data.user || null));
  }, [ctxUser]);

  const loadNarrative = useCallback(
    async (refresh = false) => {
      if (!user?.id) return;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      try {
        const resp = await fetch(`${HELIA_API_BASE}/api/health-narrative`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, refresh }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
        setNarrative(data.narrative || '');
        setGeneratedAt(data.generatedAt || null);
      } catch (err) {
        setError(err.message || String(err));
        if (refresh) {
          /* keep existing narrative on refresh failure */
        } else {
          setNarrative('');
          setGeneratedAt(null);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (user) loadNarrative(false);
  }, [user, loadNarrative]);

  return (
    <>
      <HeliaPageHeader
        title="Your health story"
        subtitle="A warm, plain-English narrative of your health journey — written for you, not your chart."
        breadcrumb={[{ label: 'My Health', to: '/dashboard' }, { label: 'Health Story' }]}
      />
      <main style={heliaPageMainStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
          <button
            type="button"
            onClick={() => void loadNarrative(true)}
            disabled={loading || refreshing || !user}
            style={{
              padding: '10px 18px',
              backgroundColor: refreshing || loading ? helia.sageMuted : helia.sage,
              color: '#fff',
              border: 'none',
              borderRadius: helia.radiusSm,
              cursor: refreshing || loading ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              fontSize: 14,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: helia.font,
            }}
          >
            {(refreshing || loading) && (
              <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
            )}
            {refreshing ? 'Regenerating…' : loading ? 'Loading…' : 'Regenerate'}
          </button>
          {generatedAt && !loading && (
            <span style={{ fontSize: 14, color: helia.muted }}>
              Last generated: {formatGeneratedAt(generatedAt)}
            </span>
          )}
        </div>

        {error && (
          <div style={{ ...heliaCardStyle, color: helia.alert, marginBottom: 16 }}>{error}</div>
        )}

        {loading && !narrative ? (
          <div style={{ ...heliaCardStyle, display: 'flex', alignItems: 'center', gap: 10, color: helia.muted }}>
            <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
            Reading your records and writing your story…
          </div>
        ) : !narrative && !error ? (
          <div style={{ ...heliaCardStyle, color: helia.muted, fontSize: 15 }}>
            Upload documents or connect hospital records, then click Regenerate to create your health story.
          </div>
        ) : (
          <article
            style={{
              ...heliaCardStyle,
              fontSize: 16,
              lineHeight: 1.7,
              color: helia.body,
            }}
          >
            {parseSummaryMarkdown(narrative, 'health-narrative')}
          </article>
        )}
      </main>
    </>
  );
}
