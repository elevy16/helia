import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { parseSummaryMarkdown } from './markdownSummary';
import HeliaSidebar from './HeliaSidebar';
import { helia, heliaInsightColors } from './heliaTheme';

function parseFlags(flagsValue) {
  if (Array.isArray(flagsValue)) return flagsValue;
  if (typeof flagsValue === 'string') {
    try {
      const parsed = JSON.parse(flagsValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function severityColors(sevRaw) {
  const sev = String(sevRaw || 'info').toLowerCase();
  if (sev === 'alert') return heliaInsightColors.alert;
  if (sev === 'warning') return heliaInsightColors.warning;
  return heliaInsightColors.info;
}

export default function Timeline() {
  const [user, setUser] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const navigate = useNavigate();

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      const u = data.user || null;
      setUser(u);
      if (!u) {
        setLoading(false);
        return;
      }
      const { data: docs, error: docsErr } = await supabase
        .from('document_texts')
        .select('id, filename, summary, red_flags, created_at')
        .eq('user_id', u.id)
        .order('created_at', { ascending: true });
      if (!mounted) return;
      if (docsErr) {
        setError('Failed to load timeline: ' + docsErr.message);
        setEntries([]);
      } else {
        setEntries(docs || []);
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, []);

  const normalized = useMemo(() => {
    return entries.map((e) => ({
      ...e,
      flags: parseFlags(e.red_flags),
    }));
  }, [entries]);

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
            Timeline
          </h1>
          <p style={{ margin: '10px 0 0', color: helia.muted, fontSize: 16 }}>
            Your documents in order — summaries and discussion points at a glance.
          </p>
        </div>

        <main style={{ padding: '12px 36px 48px', maxWidth: 920, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
      <h2 style={{ color: helia.forest, marginTop: 0, marginBottom: 16, fontSize: 20, fontWeight: 700 }}>Your document timeline</h2>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: helia.muted }}>
          <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
          Loading timeline…
        </div>
      ) : error ? (
        <div style={{ color: helia.alert }}>{error}</div>
      ) : normalized.length === 0 ? (
        <div style={{ color: helia.muted, fontSize: 16 }}>Upload your first document to start your health timeline.</div>
      ) : (
        <div style={{ display: 'grid', gap: 20 }}>
          {normalized.map((entry, idx) => {
            const key = entry.id || `${entry.filename}-${idx}`;
            const isOpen = !!expanded[key];
            const preview = entry.summary ? entry.summary.slice(0, 220) : 'No summary available yet.';
            return (
              <div key={key} style={{ position: 'relative', paddingLeft: 32 }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 10,
                    top: 0,
                    bottom: idx === normalized.length - 1 ? '52%' : -18,
                    width: 2,
                    background: 'rgba(122, 158, 126, 0.35)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: 4,
                    top: 20,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: helia.sage,
                    boxShadow: `0 0 0 4px ${helia.sageMuted}`,
                  }}
                />
                <div
                  style={{
                    borderRadius: helia.radius,
                    padding: '18px 20px',
                    background: helia.card,
                    border: `1px solid ${helia.border}`,
                    boxShadow: helia.cardShadow,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                    <div>
                      <div style={{ color: helia.forest, fontWeight: 700, fontSize: 16 }}>{entry.filename}</div>
                      <div style={{ color: helia.muted, fontSize: 14, marginTop: 4 }}>
                        Uploaded {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Unknown date'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
                      style={{
                        padding: '10px 16px',
                        background: helia.sageMuted,
                        color: helia.forest,
                        border: `1px solid rgba(122, 158, 126, 0.4)`,
                        borderRadius: helia.radiusSm,
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontFamily: helia.font,
                        fontSize: 14,
                      }}
                    >
                      {isOpen ? 'Collapse' : 'Expand'}
                    </button>
                  </div>

                  {!isOpen ? (
                    <div style={{ color: helia.body, fontSize: 15, lineHeight: 1.6 }}>
                      {preview}
                      {entry.summary && entry.summary.length > 220 ? '…' : ''}
                    </div>
                  ) : (
                    <>
                      <div style={{ marginTop: 12, borderTop: `1px solid ${helia.border}`, paddingTop: 14 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: helia.muted,
                            letterSpacing: '0.07em',
                            textTransform: 'uppercase',
                            marginBottom: 10,
                          }}
                        >
                          Summary
                        </div>
                        <div style={{ color: helia.body, fontSize: 15, lineHeight: 1.6 }}>
                          {entry.summary ? parseSummaryMarkdown(entry.summary, `timeline-${key}`) : 'No summary available yet.'}
                        </div>
                      </div>

                      <div style={{ marginTop: 14, borderTop: `1px solid ${helia.border}`, paddingTop: 14 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: helia.muted,
                            letterSpacing: '0.07em',
                            textTransform: 'uppercase',
                            marginBottom: 10,
                          }}
                        >
                          Red flags
                        </div>
                        {entry.flags.length === 0 ? (
                          <div style={{ color: helia.muted, fontSize: 15 }}>No immediate concerns found in this document.</div>
                        ) : (
                          <div style={{ display: 'grid', gap: 12 }}>
                            {entry.flags.map((flag, fIdx) => {
                              const colors = severityColors(flag.severity);
                              const sev = String(flag.severity || 'info').toLowerCase();
                              return (
                                <div
                                  key={`${key}-flag-${fIdx}`}
                                  style={{
                                    borderRadius: helia.radiusSm,
                                    padding: '12px 14px',
                                    background: colors.bg,
                                    border: `1px solid ${colors.border}`,
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: colors.dot }} />
                                    <span style={{ color: colors.label, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                                      {sev}
                                    </span>
                                  </div>
                                  <div style={{ color: helia.body, fontWeight: 600, marginBottom: 4 }}>{flag.title}</div>
                                  {flag.value && (
                                    <div style={{ color: helia.muted, fontSize: 14, marginBottom: 4 }}>
                                      <strong>Value:</strong> {flag.value}
                                    </div>
                                  )}
                                  <div style={{ color: helia.body, fontSize: 15 }}>{flag.explanation}</div>
                                  {flag.askDoctor && (
                                    <div style={{ marginTop: 8, color: helia.body, fontSize: 15 }}>
                                      <strong style={{ color: helia.sage }}>Ask your doctor:</strong> {flag.askDoctor}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
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
