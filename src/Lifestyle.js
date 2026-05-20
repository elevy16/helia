import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import HeliaSidebar from './HeliaSidebar';
import { helia } from './heliaTheme';

const HELIA_API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const CATEGORY_META = {
  nutrition: { icon: '🥗', label: 'Nutrition', bg: 'rgba(122, 158, 126, 0.12)' },
  lifestyle: { icon: '🌿', label: 'Lifestyle', bg: 'rgba(45, 90, 39, 0.08)' },
  supplement: { icon: '💊', label: 'Supplement', bg: 'rgba(212, 168, 67, 0.12)' },
  activity: { icon: '🏃', label: 'Activity', bg: 'rgba(122, 158, 126, 0.18)' },
};

function getCategoryMeta(category) {
  const key = String(category || 'lifestyle').toLowerCase();
  return CATEGORY_META[key] || CATEGORY_META.lifestyle;
}

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function Lifestyle() {
  const [user, setUser] = useState(null);
  const [tips, setTips] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  useEffect(() => {
    async function fetchUser() {
      const { data } = await supabase.auth.getUser();
      setUser(data.user || null);
    }
    fetchUser();
  }, []);

  const fetchTips = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${HELIA_API_BASE}/api/lifestyle-tips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Failed to load tips');
        return;
      }
      setTips(data.tips || []);
      setLastUpdated(data.lastUpdated || new Date().toISOString());
    } catch (err) {
      setError('Failed to load tips: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchTips();
  }, [user, fetchTips]);

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: helia.cream,
        color: helia.body,
        fontFamily: helia.font,
        fontSize: 17,
        lineHeight: 1.55,
      }}
    >
      <HeliaSidebar userEmail={user?.email} onLogout={handleLogout} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '28px 36px 8px' }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: helia.forest, letterSpacing: '-0.02em' }}>
            Nutrition &amp; Lifestyle Tips
          </h1>
          <p style={{ margin: '10px 0 0', color: helia.muted, fontSize: 16 }}>
            Actionable guidance based on your actual lab results and health records.
          </p>
        </div>

        <main style={{ padding: '12px 36px 48px', maxWidth: 920, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
            <button
              type="button"
              onClick={fetchTips}
              disabled={loading || !user}
              style={{
                padding: '12px 22px',
                backgroundColor: loading ? helia.sageMuted : helia.sage,
                color: '#fff',
                border: 'none',
                borderRadius: helia.radiusSm,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 15,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontFamily: helia.font,
              }}
            >
              {loading && <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />}
              {loading ? 'Generating…' : 'Refresh tips'}
            </button>
            {lastUpdated && (
              <span style={{ fontSize: 14, color: helia.muted }}>
                Last updated: {formatTimestamp(lastUpdated)}
              </span>
            )}
          </div>

          {error && (
            <div style={{ marginBottom: 20, color: helia.alert, fontSize: 16 }}>{error}</div>
          )}

          {loading && tips.length === 0 ? (
            <div
              style={{
                background: helia.card,
                padding: 32,
                borderRadius: helia.radius,
                border: `1px solid ${helia.border}`,
                boxShadow: helia.cardShadow,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                color: helia.muted,
              }}
            >
              <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
              Analyzing your lab results and records…
            </div>
          ) : tips.length === 0 ? (
            <div
              style={{
                background: helia.card,
                padding: 32,
                borderRadius: helia.radius,
                border: `1px dashed ${helia.border}`,
                boxShadow: helia.cardShadow,
                textAlign: 'center',
                color: helia.muted,
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>🥗</div>
              <div style={{ fontWeight: 600, color: helia.forest, marginBottom: 8, fontSize: 18 }}>
                No tips yet
              </div>
              <p style={{ margin: 0, fontSize: 15, maxWidth: 420, marginInline: 'auto' }}>
                Upload lab results or connect hospital records so Helia can generate personalized nutrition and lifestyle guidance.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {tips.map((tip, idx) => {
                const meta = getCategoryMeta(tip.category);
                return (
                  <div
                    key={`${tip.title}-${idx}`}
                    style={{
                      background: helia.card,
                      borderRadius: helia.radius,
                      padding: '20px 22px',
                      border: `1px solid ${helia.border}`,
                      boxShadow: helia.cardShadow,
                      display: 'flex',
                      gap: 16,
                      alignItems: 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: meta.bg,
                        borderRadius: helia.radiusSm,
                        fontSize: 24,
                        border: `1px solid ${helia.border}`,
                      }}
                      aria-hidden
                    >
                      {meta.icon}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: helia.forest,
                            background: meta.bg,
                            padding: '3px 8px',
                            borderRadius: 6,
                          }}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 17, color: helia.forest, marginBottom: 8 }}>
                        {tip.title}
                      </div>
                      <div style={{ fontSize: 15, color: helia.body, lineHeight: 1.6, marginBottom: 10 }}>
                        {tip.explanation}
                      </div>
                      {tip.action && (
                        <div style={{ fontSize: 15, color: helia.body, lineHeight: 1.5 }}>
                          <span style={{ color: helia.sage, fontWeight: 700 }}>Try this: </span>
                          {tip.action}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p style={{ marginTop: 24, fontSize: 13, color: helia.muted, lineHeight: 1.5 }}>
            These tips are based on your records and are not medical advice. Always discuss dietary changes and supplements with your doctor.
          </p>
        </main>
      </div>
    </div>
  );
}
