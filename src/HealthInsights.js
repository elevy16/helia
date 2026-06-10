import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from './supabaseClient';
import HeliaPageHeader from './HeliaPageHeader';
import { HELIA_API_BASE } from './chatApi';
import { helia, heliaInsightColors } from './heliaTheme';
import { heliaCardStyle, heliaPageMainStyle } from './heliaUi';
import { SeverityIcon } from './heliaIcons';

function getInsightSeverityColors(severity) {
  const s = String(severity || 'info').toLowerCase();
  if (s === 'alert') return heliaInsightColors.alert;
  if (s === 'warning') return heliaInsightColors.warning;
  return heliaInsightColors.info;
}

export default function HealthInsights() {
  const { user: ctxUser } = useOutletContext() || {};
  const [user, setUser] = useState(ctxUser || null);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ctxUser) {
      setUser(ctxUser);
      return;
    }
    supabase.auth.getUser().then(({ data }) => setUser(data.user || null));
  }, [ctxUser]);

  useEffect(() => {
    if (user) fetchHealthInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function fetchHealthInsights() {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${HELIA_API_BASE}/api/health-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Backend error: ${resp.status} ${text}`);
      }
      const data = await resp.json();
      setInsights(Array.isArray(data.insights) ? data.insights : []);
    } catch (err) {
      console.error('[health-insights] Failed to fetch:', err);
      setInsights([]);
      setError('Could not generate health insights right now.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <HeliaPageHeader
        title="Health Insights"
        subtitle="Personalized insights drawn from your documents and health profile."
        breadcrumb={[{ label: 'My Health', to: '/dashboard' }, { label: 'Insights' }]}
      />
      <main style={heliaPageMainStyle}>
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={fetchHealthInsights}
            disabled={loading || !user}
            style={{
              padding: '10px 18px',
              backgroundColor: loading ? helia.sageMuted : helia.sage,
              color: '#fff',
              border: 'none',
              borderRadius: helia.radiusSm,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {loading && <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />}
            {loading ? 'Refreshing…' : 'Refresh insights'}
          </button>
        </div>

        <div style={heliaCardStyle}>
          {loading && insights.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: helia.muted, fontSize: 15 }}>
              <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
              Generating personalized insights from your documents...
            </div>
          ) : error ? (
            <div style={{ color: helia.alert, fontSize: 15 }}>{error}</div>
          ) : insights.length === 0 ? (
            <div
              style={{
                color: helia.muted,
                fontSize: 15,
                background: helia.cream,
                border: `1px dashed ${helia.border}`,
                padding: 16,
                borderRadius: helia.radiusSm,
              }}
            >
              Upload your first document to get personalized health insights.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {insights.map((insight, idx) => {
                const sev = String(insight.severity || 'info').toLowerCase();
                const colors = getInsightSeverityColors(sev);
                return (
                  <div
                    key={`${insight.title || 'insight'}-${idx}`}
                    style={{
                      borderRadius: 12,
                      padding: '14px 16px',
                      background: colors.bg,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                      <SeverityIcon severity={sev} size={14} />
                      <span
                        style={{
                          color: colors.label,
                          fontSize: 11,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}
                      >
                        {sev}
                      </span>
                    </div>
                    <div style={{ color: helia.forest, fontWeight: 600, fontSize: 16, marginBottom: 6 }}>
                      {insight.title}
                    </div>
                    <div style={{ color: helia.body, fontSize: 15, lineHeight: 1.55 }}>{insight.description}</div>
                    {insight.actionSuggestion && (
                      <div style={{ marginTop: 10, color: helia.body, fontSize: 15, lineHeight: 1.5 }}>
                        <span style={{ color: helia.sage, fontWeight: 700 }}>Discuss with your doctor: </span>
                        {insight.actionSuggestion}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
