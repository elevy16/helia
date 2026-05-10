import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { parseSummaryMarkdown } from './markdownSummary';
import HeliaSidebar from './HeliaSidebar';
import { helia } from './heliaTheme';

const HELIA_API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export default function AppointmentDebrief() {
  const [user, setUser] = useState(null);
  const [doctor, setDoctor] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [notes, setNotes] = useState('');
  const [prescriptions, setPrescriptions] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [latestSummary, setLatestSummary] = useState('');
  const [debriefs, setDebriefs] = useState([]);
  const [loadingDebriefs, setLoadingDebriefs] = useState(true);
  const navigate = useNavigate();

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  useEffect(() => {
    let mounted = true;
    async function loadUserAndDebriefs() {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      const currentUser = data.user || null;
      setUser(currentUser);
      if (currentUser) {
        await fetchDebriefs(currentUser.id);
      } else {
        setLoadingDebriefs(false);
      }
    }
    loadUserAndDebriefs();
    return () => { mounted = false; };
  }, []);

  async function fetchDebriefs(userId) {
    setLoadingDebriefs(true);
    const { data, error: fetchErr } = await supabase
      .from('debriefs')
      .select('id, doctor, appointment_date, ai_summary, created_at')
      .eq('user_id', userId)
      .order('appointment_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (fetchErr) {
      setError('Failed to load debriefs: ' + fetchErr.message);
      setDebriefs([]);
    } else {
      setDebriefs(data || []);
    }
    setLoadingDebriefs(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLatestSummary('');

    if (!user) {
      setError('Please log in again.');
      return;
    }
    if (!doctor.trim() || !appointmentDate || !notes.trim() || !prescriptions.trim() || !nextSteps.trim()) {
      setError('Please complete all fields before submitting.');
      return;
    }

    setSaving(true);
    try {
      const resp = await fetch(`${HELIA_API_BASE}/api/save-debrief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          doctor: doctor.trim(),
          appointmentDate,
          notes: notes.trim(),
          prescriptions: prescriptions.trim(),
          nextSteps: nextSteps.trim(),
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Server error: ${resp.status} ${text}`);
      }

      const data = await resp.json();
      const summary = data?.debrief?.ai_summary || '';
      setLatestSummary(summary);
      setDoctor('');
      setAppointmentDate('');
      setNotes('');
      setPrescriptions('');
      setNextSteps('');
      await fetchDebriefs(user.id);
    } catch (err) {
      setError('Failed to save debrief: ' + (err.message || err));
    } finally {
      setSaving(false);
    }
  }

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
            Appointment debrief
          </h1>
          <p style={{ margin: '10px 0 0', color: helia.muted, fontSize: 16 }}>
            Capture what happened at your visit and get a clear AI summary you can revisit.
          </p>
        </div>

        <main style={{ padding: '12px 36px 48px', maxWidth: 920, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: helia.card,
          padding: 28,
          borderRadius: helia.radius,
          border: `1px solid ${helia.border}`,
          boxShadow: helia.cardShadow,
          color: helia.body,
        }}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <label style={{ color: helia.forest, fontWeight: 600 }}>
            <div style={{ marginBottom: 8 }}>Who did you see?</div>
            <input
              value={doctor}
              onChange={(e) => setDoctor(e.target.value)}
              disabled={saving}
              placeholder="Dr. Smith, endocrinologist, therapist, etc."
              style={{ ...fieldStyle, opacity: saving ? 0.65 : 1 }}
            />
          </label>

          <label style={{ color: helia.forest, fontWeight: 600 }}>
            <div style={{ marginBottom: 8 }}>Date of appointment</div>
            <input
              type="date"
              value={appointmentDate}
              onChange={(e) => setAppointmentDate(e.target.value)}
              disabled={saving}
              style={{ ...fieldStyle, maxWidth: 280, opacity: saving ? 0.65 : 1 }}
            />
          </label>

          <label style={{ color: helia.forest, fontWeight: 600 }}>
            <div style={{ marginBottom: 8 }}>What did they say?</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
              placeholder="Diagnosis, key notes, instructions..."
              style={{ ...fieldStyle, minHeight: 96, resize: 'vertical', opacity: saving ? 0.65 : 1 }}
            />
          </label>

          <label style={{ color: helia.forest, fontWeight: 600 }}>
            <div style={{ marginBottom: 8 }}>What was prescribed or recommended?</div>
            <textarea
              value={prescriptions}
              onChange={(e) => setPrescriptions(e.target.value)}
              disabled={saving}
              placeholder="Medications, referrals, lifestyle recommendations..."
              style={{ ...fieldStyle, minHeight: 86, resize: 'vertical', opacity: saving ? 0.65 : 1 }}
            />
          </label>

          <label style={{ color: helia.forest, fontWeight: 600 }}>
            <div style={{ marginBottom: 8 }}>What are your next steps or follow-ups?</div>
            <textarea
              value={nextSteps}
              onChange={(e) => setNextSteps(e.target.value)}
              disabled={saving}
              placeholder="Labs, follow-up visit date, action items..."
              style={{ ...fieldStyle, minHeight: 86, resize: 'vertical', opacity: saving ? 0.65 : 1 }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '14px 24px',
              backgroundColor: saving ? helia.sageMuted : helia.sage,
              color: '#fff',
              border: 'none',
              borderRadius: helia.radiusSm,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: 17,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: helia.font,
            }}
          >
            {saving && <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />}
            {saving ? 'Saving debrief…' : 'Save debrief'}
          </button>
          {saving && (
            <span style={{ color: helia.muted, fontSize: 15 }}>Generating AI summary and saving…</span>
          )}
        </div>
      </form>

      {error && <div style={{ marginTop: 18, color: helia.alert, fontSize: 16 }}>{error}</div>}

      {latestSummary && (
        <div
          style={{
            marginTop: 28,
            borderRadius: helia.radius,
            padding: 24,
            background: helia.card,
            border: `1px solid ${helia.border}`,
            boxShadow: helia.cardShadow,
            color: helia.body,
          }}
        >
          <div style={{ fontWeight: 700, color: helia.forest, marginBottom: 12, fontSize: 17 }}>AI debrief summary</div>
          <div style={{ color: helia.body, fontSize: 16, lineHeight: 1.6 }}>
            {parseSummaryMarkdown(latestSummary, 'latest-debrief-summary')}
          </div>
        </div>
      )}

      <section style={{ marginTop: 36 }}>
        <h2 style={{ color: helia.forest, marginBottom: 16, fontSize: 20, fontWeight: 700 }}>My debriefs</h2>
        {loadingDebriefs ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: helia.muted }}>
            <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
            Loading debrief history…
          </div>
        ) : debriefs.length === 0 ? (
          <div style={{ color: helia.muted, fontSize: 16 }}>No debriefs yet. Submit your first appointment debrief above.</div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {debriefs.map((d) => (
              <div
                key={d.id}
                style={{
                  borderRadius: helia.radius,
                  padding: '18px 20px',
                  background: helia.card,
                  border: `1px solid ${helia.border}`,
                  boxShadow: helia.cardShadow,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={{ color: helia.forest, fontWeight: 700, fontSize: 16 }}>{d.doctor}</div>
                  <div style={{ color: helia.muted, fontSize: 14 }}>
                    {d.appointment_date ? new Date(`${d.appointment_date}T00:00:00`).toLocaleDateString() : 'No date'}
                  </div>
                </div>
                <div style={{ color: helia.body, fontSize: 15, lineHeight: 1.55 }}>
                  {((d.ai_summary || '').slice(0, 260))}
                  {(d.ai_summary || '').length > 260 ? '…' : ''}
                </div>
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
