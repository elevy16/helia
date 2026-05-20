import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import HeliaSidebar from './HeliaSidebar';
import { helia, heliaInsightColors } from './heliaTheme';

const HELIA_API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function getUrgencyColors(urgency) {
  const u = String(urgency || 'info').toLowerCase();
  if (u === 'alert') return heliaInsightColors.alert;
  if (u === 'warning') return heliaInsightColors.warning;
  return heliaInsightColors.info;
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

export default function HealthAlerts() {
  const [user, setUser] = useState(null);
  const [alerts, setAlerts] = useState([]);
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

  const fetchAlerts = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const resp = await fetch(`${HELIA_API_BASE}/api/health-alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Failed to load alerts');
        return;
      }
      setAlerts(data.alerts || []);
      setLastUpdated(data.lastUpdated || new Date().toISOString());
    } catch (err) {
      setError('Failed to load alerts: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchAlerts();
  }, [user, fetchAlerts]);

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
            Health Alerts
          </h1>
          <p style={{ margin: '10px 0 0', color: helia.muted, fontSize: 16 }}>
            Personalized news and follow-up reminders based on your health profile.
          </p>
        </div>

        <main style={{ padding: '12px 36px 48px', maxWidth: 920, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
            <button
              type="button"
              onClick={fetchAlerts}
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
              {loading ? 'Refreshing…' : 'Refresh alerts'}
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

          {loading && alerts.length === 0 ? (
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
              Scanning your records and health news…
            </div>
          ) : alerts.length === 0 ? (
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
              <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>🔔</div>
              <div style={{ fontWeight: 600, color: helia.forest, marginBottom: 8, fontSize: 18 }}>
                No relevant alerts right now
              </div>
              <p style={{ margin: 0, fontSize: 15, maxWidth: 420, marginInline: 'auto' }}>
                Upload health documents or connect hospital records to get personalized alerts and follow-up reminders.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {alerts.map((alert, idx) => {
                const colors = getUrgencyColors(alert.urgency);
                return (
                  <div
                    key={`${alert.title}-${idx}`}
                    style={{
                      background: helia.card,
                      borderRadius: helia.radius,
                      padding: '20px 22px',
                      border: `1px solid ${colors.border}`,
                      boxShadow: helia.cardShadow,
                      borderLeft: `4px solid ${colors.dot}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                      <span
                        aria-hidden
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: colors.dot,
                        }}
                      />
                      <span
                        style={{
                          color: colors.label,
                          fontSize: 11,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}
                      >
                        {alert.urgency || 'info'}
                      </span>
                      {alert.source && (
                        <span style={{ marginLeft: 'auto', fontSize: 13, color: helia.muted }}>
                          {alert.source}
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 17, color: helia.forest, marginBottom: 8 }}>
                      {alert.title}
                    </div>
                    <div style={{ fontSize: 15, color: helia.body, lineHeight: 1.6, marginBottom: 10 }}>
                      {alert.description}
                    </div>
                    {alert.relevanceExplanation && (
                      <div
                        style={{
                          fontSize: 14,
                          color: helia.muted,
                          background: helia.cream,
                          padding: '10px 14px',
                          borderRadius: helia.radiusSm,
                          marginBottom: 10,
                          lineHeight: 1.5,
                        }}
                      >
                        <span style={{ fontWeight: 600, color: helia.forest }}>Why this matters for you: </span>
                        {alert.relevanceExplanation}
                      </div>
                    )}
                    {alert.actionSuggestion && (
                      <div style={{ fontSize: 15, color: helia.body, lineHeight: 1.5 }}>
                        <span style={{ color: helia.sage, fontWeight: 700 }}>Suggested action: </span>
                        {alert.actionSuggestion}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
