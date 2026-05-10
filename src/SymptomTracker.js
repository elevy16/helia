import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import HeliaSidebar from './HeliaSidebar';
import { helia } from './heliaTheme';

function startOfMondayWeek(ref = new Date()) {
  const d = new Date(ref);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfMondayWeek(ref = new Date()) {
  const start = startOfMondayWeek(ref);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return end;
}

function inThisCalendarWeek(isoString, ref = new Date()) {
  const t = new Date(isoString);
  return t >= startOfMondayWeek(ref) && t < endOfMondayWeek(ref);
}

function normalizeSymptomKey(name) {
  return (name || '').trim().toLowerCase() || '—';
}

export default function SymptomTracker() {
  const [user, setUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [symptom, setSymptom] = useState('');
  const [severity, setSeverity] = useState(5);
  const [loggedDate, setLoggedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let m = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!m) return;
      setUser(data.user || null);
    })();
    return () => {
      m = false;
    };
  }, []);

  async function loadSymptoms() {
    if (!user?.id) return;
    setLoading(true);
    setError('');
    const { data, error: qErr } = await supabase
      .from('symptoms')
      .select('id, symptom, severity, notes, logged_at, created_at')
      .eq('user_id', user.id)
      .order('logged_at', { ascending: false });
    if (qErr) {
      setError(qErr.message);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (user) loadSymptoms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!user?.id || !symptom.trim()) {
      setError('Enter a symptom name.');
      return;
    }
    setSaving(true);
    setError('');
    const loggedAtIso = new Date(`${loggedDate}T12:00:00`).toISOString();
    const { error: insErr } = await supabase.from('symptoms').insert([
      {
        user_id: user.id,
        symptom: symptom.trim(),
        severity: Number(severity),
        notes: notes.trim() || null,
        logged_at: loggedAtIso,
      },
    ]);
    setSaving(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setSymptom('');
    setSeverity(5);
    setLoggedDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    await loadSymptoms();
  }

  const grouped = {};
  for (const r of rows) {
    const k = normalizeSymptomKey(r.symptom);
    if (!grouped[k]) grouped[k] = { displayName: r.symptom.trim() || '—', entries: [], thisWeek: 0 };
    grouped[k].entries.push(r);
    if (inThisCalendarWeek(r.logged_at)) grouped[k].thisWeek += 1;
  }

  const groupList = Object.values(grouped).sort((a, b) => b.entries.length - a.entries.length);

  const fieldStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 14px',
    background: helia.cream,
    border: `1px solid ${helia.border}`,
    borderRadius: helia.radiusSm,
    color: helia.body,
    fontSize: 16,
    fontFamily: helia.font,
    outline: 'none',
  };

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
            Symptom tracker
          </h1>
          <p style={{ margin: '10px 0 0', color: helia.muted, fontSize: 16 }}>
            Log how you feel and spot patterns over time.
          </p>
        </div>

        <main style={{ padding: '12px 36px 48px', maxWidth: 920, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>Log a symptom</h2>
            <form
              onSubmit={handleSubmit}
              style={{
                background: helia.card,
                padding: 24,
                borderRadius: helia.radius,
                border: `1px solid ${helia.border}`,
                boxShadow: helia.cardShadow,
              }}
            >
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: helia.forest }}>Symptom</label>
                <input
                  type="text"
                  value={symptom}
                  onChange={(e) => setSymptom(e.target.value)}
                  placeholder="e.g. headache, fatigue"
                  disabled={saving}
                  style={{ ...fieldStyle, opacity: saving ? 0.7 : 1 }}
                />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: helia.forest }}>
                  Severity: {severity} / 10
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={severity}
                  onChange={(e) => setSeverity(Number(e.target.value))}
                  disabled={saving}
                  style={{ width: '100%', accentColor: helia.sage }}
                />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: helia.forest }}>Date</label>
                <input
                  type="date"
                  value={loggedDate}
                  onChange={(e) => setLoggedDate(e.target.value)}
                  disabled={saving}
                  style={{ ...fieldStyle, opacity: saving ? 0.7 : 1 }}
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: helia.forest }}>
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Triggers, duration, what helped…"
                  disabled={saving}
                  rows={3}
                  style={{ ...fieldStyle, resize: 'vertical', minHeight: 88, opacity: saving ? 0.7 : 1 }}
                />
              </div>
              {error && <div style={{ color: helia.alert, marginBottom: 14, fontSize: 15 }}>{error}</div>}
              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: '12px 22px',
                  fontWeight: 700,
                  background: saving ? helia.sageMuted : helia.sage,
                  color: '#fff',
                  border: `1px solid rgba(122, 158, 126, 0.4)`,
                  borderRadius: helia.radiusSm,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontFamily: helia.font,
                }}
              >
                {saving ? 'Saving…' : 'Save entry'}
              </button>
            </form>
          </section>

          <section style={{ marginBottom: 28 }}>
            <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>Trends by symptom</h2>
            {loading ? (
              <div style={{ color: helia.muted }}>Loading…</div>
            ) : groupList.length === 0 ? (
              <div
                style={{
                  padding: 20,
                  background: helia.card,
                  borderRadius: helia.radius,
                  border: `1px dashed ${helia.border}`,
                  color: helia.muted,
                }}
              >
                No symptoms logged yet.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {groupList.map((g) => (
                  <div
                    key={g.entries[0]?.id || g.displayName}
                    style={{
                      padding: 18,
                      borderRadius: helia.radius,
                      background: helia.sageMuted,
                      border: `1px solid rgba(122, 158, 126, 0.35)`,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: helia.forest, marginBottom: 8 }}>{g.displayName}</div>
                    <div style={{ fontSize: 14, color: helia.body }}>
                      <strong>{g.thisWeek}</strong> this week · <strong>{g.entries.length}</strong> total
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>History</h2>
            <p style={{ color: helia.muted, fontSize: 15, marginTop: 0, marginBottom: 14 }}>
              Newest first — same symptom may appear multiple times as you track changes.
            </p>
            {!loading && rows.length === 0 ? null : (
              <div style={{ display: 'grid', gap: 12 }}>
                {rows.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      padding: 18,
                      borderRadius: helia.radius,
                      background: helia.card,
                      border: `1px solid ${helia.border}`,
                      boxShadow: helia.cardShadow,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, color: helia.forest }}>{r.symptom}</div>
                      <div style={{ fontSize: 14, color: helia.muted }}>
                        {r.logged_at ? new Date(r.logged_at).toLocaleString() : ''}
                      </div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 15 }}>
                      Severity: <strong>{r.severity}</strong> / 10
                    </div>
                    {r.notes && (
                      <div style={{ marginTop: 10, fontSize: 15, color: helia.body }}>{r.notes}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
