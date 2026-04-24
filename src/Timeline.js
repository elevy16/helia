import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { parseSummaryMarkdown } from './markdownSummary';

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
  if (sev === 'alert') {
    return { dot: '#dc6f6f', bg: 'rgba(64,26,26,0.45)', border: 'rgba(220,111,111,0.45)', label: '#f3c4c4' };
  }
  if (sev === 'warning') {
    return { dot: '#d5b562', bg: 'rgba(65,52,22,0.44)', border: 'rgba(213,181,98,0.42)', label: '#efe0b4' };
  }
  return { dot: '#78ae78', bg: 'rgba(33,60,33,0.44)', border: 'rgba(120,174,120,0.4)', label: '#cde6cd' };
}

export default function Timeline() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});

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
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1a2e1a, #162616)', color: 'white', fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 36px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: '#6a9e6a', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12, fontWeight: 'bold' }}>MA</div>
          <h2 style={{ margin: 0 }}>Health Timeline</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user?.email && <div style={{ color: '#9fb89f', fontSize: 14 }}>{user.email}</div>}
          <button onClick={() => navigate('/dashboard')} style={{ padding: '8px 12px', background: '#6a9e6a', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
            Back to Dashboard
          </button>
        </div>
      </header>

      <main style={{ padding: '28px 36px', maxWidth: 980 }}>
        <h3 style={{ color: '#a8c5a0', marginBottom: 14 }}>Your Document Timeline</h3>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#9fb89f' }}>
            <span className="ma-spinner ma-spinner--sm" aria-hidden />
            Loading timeline...
          </div>
        ) : error ? (
          <div style={{ color: '#ffb3b3' }}>{error}</div>
        ) : normalized.length === 0 ? (
          <div style={{ color: '#a8c5a0' }}>Upload your first document to start your health timeline.</div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {normalized.map((entry, idx) => {
              const key = entry.id || `${entry.filename}-${idx}`;
              const isOpen = !!expanded[key];
              const preview = entry.summary ? entry.summary.slice(0, 220) : 'No summary available yet.';
              return (
                <div key={key} style={{ position: 'relative', paddingLeft: 28 }}>
                  <div style={{ position: 'absolute', left: 8, top: 0, bottom: idx === normalized.length - 1 ? '52%' : -16, width: 2, background: 'rgba(106,158,106,0.35)' }} />
                  <div style={{ position: 'absolute', left: 2, top: 18, width: 14, height: 14, borderRadius: '50%', background: '#6a9e6a', boxShadow: '0 0 0 4px rgba(106,158,106,0.22)' }} />
                  <div style={{ borderRadius: 12, padding: '14px 16px', background: 'rgba(22, 38, 22, 0.55)', border: '1px solid rgba(106, 158, 106, 0.2)', boxShadow: '0 4px 20px rgba(0, 0, 0, 0.14)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                      <div>
                        <div style={{ color: '#e8f0e8', fontWeight: 600 }}>{entry.filename}</div>
                        <div style={{ color: '#9fb89f', fontSize: 13 }}>
                          Uploaded {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Unknown date'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
                        style={{ padding: '8px 12px', background: 'rgba(106, 158, 106, 0.12)', color: '#d4ead4', border: '1px solid rgba(106, 158, 106, 0.45)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
                      >
                        {isOpen ? 'Collapse' : 'Expand'}
                      </button>
                    </div>

                    {!isOpen ? (
                      <div style={{ color: '#c8dcc8', fontSize: 14, lineHeight: 1.55 }}>
                        {preview}{entry.summary && entry.summary.length > 220 ? '...' : ''}
                      </div>
                    ) : (
                      <>
                        <div style={{ marginTop: 8, borderTop: '1px solid rgba(106, 158, 106, 0.14)', paddingTop: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#7a9a7a', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                            Summary
                          </div>
                          <div style={{ color: '#c8dcc8', fontSize: 14, lineHeight: 1.55 }}>
                            {entry.summary ? parseSummaryMarkdown(entry.summary, `timeline-${key}`) : 'No summary available yet.'}
                          </div>
                        </div>

                        <div style={{ marginTop: 12, borderTop: '1px solid rgba(106, 158, 106, 0.14)', paddingTop: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#7a9a7a', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                            Red Flags
                          </div>
                          {entry.flags.length === 0 ? (
                            <div style={{ color: '#cde6cd', fontSize: 14 }}>No immediate concerns found in this document.</div>
                          ) : (
                            <div style={{ display: 'grid', gap: 10 }}>
                              {entry.flags.map((flag, fIdx) => {
                                const colors = severityColors(flag.severity);
                                const sev = String(flag.severity || 'info').toLowerCase();
                                return (
                                  <div key={`${key}-flag-${fIdx}`} style={{ borderRadius: 10, padding: '10px 12px', background: colors.bg, border: `1px solid ${colors.border}` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: colors.dot }} />
                                      <span style={{ color: colors.label, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{sev}</span>
                                    </div>
                                    <div style={{ color: '#e8f0e8', fontWeight: 600, marginBottom: 4 }}>{flag.title}</div>
                                    {flag.value && <div style={{ color: '#dceadc', fontSize: 13, marginBottom: 4 }}><strong>Value:</strong> {flag.value}</div>}
                                    <div style={{ color: '#c8dcc8', fontSize: 14 }}>{flag.explanation}</div>
                                    {flag.askDoctor && <div style={{ marginTop: 6, color: '#d8e8d8', fontSize: 14 }}><strong>Ask your doctor:</strong> {flag.askDoctor}</div>}
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
  );
}
