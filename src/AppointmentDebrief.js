import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { parseSummaryMarkdown } from './markdownSummary';

export default function AppointmentDebrief() {
  const navigate = useNavigate();
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
      const resp = await fetch('http://localhost:3001/api/save-debrief', {
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

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1a2e1a, #162616)', color: 'white', fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 36px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: '#6a9e6a', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12, fontWeight: 'bold' }}>MA</div>
          <h2 style={{ margin: 0 }}>Helia - Post-Appointment Debrief</h2>
        </div>
        <button onClick={() => navigate('/dashboard')} style={{ padding: '8px 12px', background: 'transparent', color: '#a8c5a0', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, cursor: 'pointer' }}>
          Back to Dashboard
        </button>
      </header>

      <main style={{ padding: '28px 36px', maxWidth: 980 }}>
        <h3 style={{ color: '#a8c5a0', marginBottom: 20 }}>Post-Appointment Debrief</h3>

        <form onSubmit={handleSubmit} style={{ background: 'rgba(22, 38, 22, 0.45)', padding: 22, borderRadius: 12, border: '1px solid rgba(106, 158, 106, 0.16)', boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)', color: '#e8f0e8' }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <label style={{ color: '#a8c5a0' }}>
              <div style={{ marginBottom: 6 }}>Who did you see?</div>
              <input value={doctor} onChange={(e) => setDoctor(e.target.value)} disabled={saving} placeholder="Dr. Smith, endocrinologist, therapist, etc." style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(106, 158, 106, 0.22)', borderRadius: 8, color: '#e8f0e8', fontSize: 16, outline: 'none', opacity: saving ? 0.65 : 1 }} />
            </label>

            <label style={{ color: '#a8c5a0' }}>
              <div style={{ marginBottom: 6 }}>Date of appointment</div>
              <input type="date" value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} disabled={saving} style={{ width: 240, boxSizing: 'border-box', padding: '12px 14px', background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(106, 158, 106, 0.22)', borderRadius: 8, color: '#e8f0e8', fontSize: 16, outline: 'none', opacity: saving ? 0.65 : 1 }} />
            </label>

            <label style={{ color: '#a8c5a0' }}>
              <div style={{ marginBottom: 6 }}>What did they say?</div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} placeholder="Diagnosis, key notes, instructions..." style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(106, 158, 106, 0.22)', borderRadius: 8, color: '#e8f0e8', fontSize: 16, minHeight: 96, resize: 'vertical', outline: 'none', opacity: saving ? 0.65 : 1 }} />
            </label>

            <label style={{ color: '#a8c5a0' }}>
              <div style={{ marginBottom: 6 }}>What was prescribed or recommended?</div>
              <textarea value={prescriptions} onChange={(e) => setPrescriptions(e.target.value)} disabled={saving} placeholder="Medications, referrals, lifestyle recommendations..." style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(106, 158, 106, 0.22)', borderRadius: 8, color: '#e8f0e8', fontSize: 16, minHeight: 86, resize: 'vertical', outline: 'none', opacity: saving ? 0.65 : 1 }} />
            </label>

            <label style={{ color: '#a8c5a0' }}>
              <div style={{ marginBottom: 6 }}>What are your next steps or follow-ups?</div>
              <textarea value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} disabled={saving} placeholder="Labs, follow-up visit date, action items..." style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(106, 158, 106, 0.22)', borderRadius: 8, color: '#e8f0e8', fontSize: 16, minHeight: 86, resize: 'vertical', outline: 'none', opacity: saving ? 0.65 : 1 }} />
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <button type="submit" disabled={saving} style={{ padding: '12px 22px', backgroundColor: saving ? 'rgba(106, 158, 106, 0.45)' : '#6a9e6a', color: 'white', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              {saving && <span className="ma-spinner ma-spinner--sm" style={{ borderTopColor: 'rgba(255,255,255,0.9)' }} aria-hidden />}
              {saving ? 'Saving Debrief…' : 'Save Debrief'}
            </button>
            {saving && <span style={{ color: '#9fb89f', fontSize: 14 }}>Generating AI summary and saving your debrief...</span>}
          </div>
        </form>

        {error && <div style={{ marginTop: 14, color: '#ffb3b3' }}>{error}</div>}

        {latestSummary && (
          <div style={{ marginTop: 22, borderRadius: 12, padding: '16px 18px', background: 'rgba(22, 38, 22, 0.55)', border: '1px solid rgba(106, 158, 106, 0.2)', boxShadow: '0 4px 20px rgba(0, 0, 0, 0.14)', color: '#e8f0e8' }}>
            <div style={{ fontWeight: 600, color: '#a8c5a0', marginBottom: 8 }}>AI Debrief Summary</div>
            <div style={{ color: '#c8dcc8', fontSize: 15, lineHeight: 1.55 }}>
              {parseSummaryMarkdown(latestSummary, 'latest-debrief-summary')}
            </div>
          </div>
        )}

        <section style={{ marginTop: 28 }}>
          <h4 style={{ color: '#a8c5a0', marginBottom: 12 }}>My Debriefs</h4>
          {loadingDebriefs ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#9fb89f' }}>
              <span className="ma-spinner ma-spinner--sm" aria-hidden />
              Loading debrief history...
            </div>
          ) : debriefs.length === 0 ? (
            <div style={{ color: '#a8c5a0' }}>No debriefs yet. Submit your first appointment debrief above.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {debriefs.map((d) => (
                <div key={d.id} style={{ borderRadius: 12, padding: '14px 16px', background: 'rgba(22, 38, 22, 0.55)', border: '1px solid rgba(106, 158, 106, 0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                    <div style={{ color: '#e8f0e8', fontWeight: 600 }}>{d.doctor}</div>
                    <div style={{ color: '#9fb89f', fontSize: 13 }}>
                      {d.appointment_date ? new Date(`${d.appointment_date}T00:00:00`).toLocaleDateString() : 'No date'}
                    </div>
                  </div>
                  <div style={{ color: '#c8dcc8', fontSize: 14, lineHeight: 1.5 }}>
                    {((d.ai_summary || '').slice(0, 260))}{(d.ai_summary || '').length > 260 ? '...' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
