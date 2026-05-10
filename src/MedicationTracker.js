import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import HeliaSidebar from './HeliaSidebar';
import { parseSummaryMarkdown } from './markdownSummary';
import { helia } from './heliaTheme';

const HELIA_API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function normalizeSseBuffer(s) {
  return String(s || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseSseEventBlock(block) {
  const normalized = normalizeSseBuffer(block);
  const trimmed = normalized.trim();
  if (!trimmed) return null;
  let eventName = 'message';
  const dataParts = [];
  for (const line of trimmed.split('\n')) {
    const lineNorm = line.replace(/\r$/, '');
    if (lineNorm.startsWith('event:')) eventName = lineNorm.slice(6).trim();
    else if (lineNorm.startsWith('data:')) dataParts.push(lineNorm.slice(5).trimStart());
  }
  const dataStr = dataParts.join('\n');
  if (!dataStr) return null;
  try {
    return { eventName, data: JSON.parse(dataStr) };
  } catch {
    return null;
  }
}

/** Collect full assistant text from POST /api/chat (SSE) — same wire format as Dashboard chat. */
async function collectChatReplyFromSseStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        carry = normalizeSseBuffer(carry);
        let sep;
        while ((sep = carry.indexOf('\n\n')) !== -1) {
          const rawBlock = carry.slice(0, sep);
          carry = carry.slice(sep + 2);
          const parsed = parseSseEventBlock(rawBlock);
          if (!parsed) continue;
          if (parsed.eventName === 'delta' && parsed.data?.text) fullText += parsed.data.text;
          else if (parsed.eventName === 'error') throw new Error(parsed.data?.message || 'Stream error');
          else if (parsed.eventName === 'done') return fullText;
        }
        if (carry.trim()) {
          const lastTry = parseSseEventBlock(carry);
          if (lastTry?.eventName === 'delta' && lastTry.data?.text) fullText += lastTry.data.text;
        }
        return fullText;
      }

      carry += decoder.decode(value, { stream: true });
      carry = normalizeSseBuffer(carry);

      let sep;
      while ((sep = carry.indexOf('\n\n')) !== -1) {
        const rawBlock = carry.slice(0, sep);
        carry = carry.slice(sep + 2);
        const parsed = parseSseEventBlock(rawBlock);
        if (!parsed) continue;
        if (parsed.eventName === 'delta' && parsed.data?.text) fullText += parsed.data.text;
        else if (parsed.eventName === 'error') throw new Error(parsed.data?.message || 'Stream error');
        else if (parsed.eventName === 'done') return fullText;
      }
    }
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      /* ignore */
    }
  }
  return fullText;
}

async function fetchMedicationSafetyReview(userId, med) {
  const prompt = `The patient just added this medication to their personal tracker:

- Medication name: ${med.name}
- Dosage: ${med.dosage}
- Frequency: ${med.frequency}
- Start date: ${med.start_date}
${med.notes ? `- Patient notes: ${med.notes}` : ''}

Your task: Based on general medication safety knowledge and any document context the Helia app retrieves for this user, briefly flag potential concerns the patient should discuss with a doctor or pharmacist (interactions, overlapping conditions, monitoring, questions to ask). Do not diagnose. Use clear sections or short bullets. If document context is thin, still offer sensible questions to bring to a clinician.`;

  const body = JSON.stringify({
    messages: [{ role: 'user', content: prompt }],
    userId,
  });

  const resp = await fetch(`${HELIA_API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `HTTP ${resp.status}`);
  }

  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream') || !resp.body) {
    const errText = await resp.text();
    throw new Error(errText || 'Expected streaming response');
  }

  return (await collectChatReplyFromSseStream(resp.body)).trim();
}

export default function MedicationTracker() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [lastReview, setLastReview] = useState('');
  const [reviewError, setReviewError] = useState('');
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

  async function loadMedications() {
    if (!user?.id) return;
    setLoading(true);
    setError('');
    const { data, error: qErr } = await supabase
      .from('medications')
      .select('id, name, dosage, frequency, start_date, notes, active, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (qErr) {
      setError(qErr.message);
      setItems([]);
    } else {
      setItems(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (user) loadMedications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  async function setMedicationActive(id, active) {
    if (!user?.id) return;
    setError('');
    const { error: uErr } = await supabase.from('medications').update({ active }).eq('id', id).eq('user_id', user.id);
    if (uErr) setError(uErr.message);
    else await loadMedications();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!user?.id || !name.trim() || !dosage.trim() || !frequency.trim()) {
      setError('Name, dosage, and frequency are required.');
      return;
    }
    setSaving(true);
    setError('');
    setReviewError('');
    setLastReview('');

    const row = {
      user_id: user.id,
      name: name.trim(),
      dosage: dosage.trim(),
      frequency: frequency.trim(),
      start_date: startDate,
      notes: notes.trim() || null,
      active: true,
    };

    const { data: inserted, error: insErr } = await supabase.from('medications').insert([row]).select().single();

    if (insErr) {
      setSaving(false);
      setError(insErr.message);
      return;
    }

    setName('');
    setDosage('');
    setFrequency('');
    setStartDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    await loadMedications();

    setSaving(false);

    if (inserted) {
      setReviewLoading(true);
      try {
        const text = await fetchMedicationSafetyReview(user.id, {
          name: inserted.name,
          dosage: inserted.dosage,
          frequency: inserted.frequency,
          start_date: inserted.start_date,
          notes: inserted.notes,
        });
        setLastReview(text);
      } catch (err) {
        console.error('[MedicationTracker] safety review:', err);
        setReviewError(err.message || 'Could not generate a review.');
      } finally {
        setReviewLoading(false);
      }
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

  const activeList = items.filter((m) => m.active);
  const inactiveList = items.filter((m) => !m.active);

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
            Medication tracker
          </h1>
          <p style={{ margin: '10px 0 0', color: helia.muted, fontSize: 16 }}>
            Track what you take and get a quick Helia check-in when you add something new.
          </p>
        </div>

        <main style={{ padding: '12px 36px 48px', maxWidth: 920, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>Add medication</h2>
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
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: helia.forest }}>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={saving}
                  style={{ ...fieldStyle, opacity: saving ? 0.7 : 1 }}
                  placeholder="e.g. Lisinopril"
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: helia.forest }}>Dosage</label>
                <input
                  type="text"
                  value={dosage}
                  onChange={(e) => setDosage(e.target.value)}
                  disabled={saving}
                  style={{ ...fieldStyle, opacity: saving ? 0.7 : 1 }}
                  placeholder="e.g. 10 mg"
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: helia.forest }}>Frequency</label>
                <input
                  type="text"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  disabled={saving}
                  style={{ ...fieldStyle, opacity: saving ? 0.7 : 1 }}
                  placeholder="e.g. Once daily with food"
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: helia.forest }}>Start date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={saving}
                  style={{ ...fieldStyle, opacity: saving ? 0.7 : 1 }}
                />
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: helia.forest }}>
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={saving}
                  rows={2}
                  style={{ ...fieldStyle, resize: 'vertical', minHeight: 72, opacity: saving ? 0.7 : 1 }}
                  placeholder="Prescriber, reason, side effects to watch…"
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
                {saving ? 'Saving…' : 'Save medication'}
              </button>
            </form>
          </section>

          {(reviewLoading || lastReview || reviewError) && (
            <section style={{ marginBottom: 32 }}>
              <h2 style={{ color: helia.forest, marginBottom: 12, fontSize: 20, fontWeight: 700 }}>Helia check-in</h2>
              <div
                style={{
                  padding: 22,
                  borderRadius: helia.radius,
                  background: helia.successBg,
                  border: `1px solid rgba(122, 158, 126, 0.4)`,
                }}
              >
                {reviewLoading && (
                  <div style={{ color: helia.muted, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
                    Reviewing your medication against your records…
                  </div>
                )}
                {reviewError && !reviewLoading && <div style={{ color: helia.alert }}>{reviewError}</div>}
                {lastReview && !reviewLoading && (
                  <div style={{ fontSize: 15, color: helia.body }}>
                    {parseSummaryMarkdown(lastReview, 'med-review') || (
                      <span style={{ whiteSpace: 'pre-wrap' }}>{lastReview}</span>
                    )}
                  </div>
                )}
              </div>
              <p style={{ fontSize: 13, color: helia.muted, marginTop: 10, marginBottom: 0 }}>
                This is educational only—not medical advice. Always confirm changes with your clinician.
              </p>
            </section>
          )}

          <section style={{ marginBottom: 28 }}>
            <h2 style={{ color: helia.forest, marginBottom: 14, fontSize: 20, fontWeight: 700 }}>Current medications</h2>
            {loading ? (
              <div style={{ color: helia.muted }}>Loading…</div>
            ) : activeList.length === 0 ? (
              <div
                style={{
                  padding: 20,
                  background: helia.card,
                  borderRadius: helia.radius,
                  border: `1px dashed ${helia.border}`,
                  color: helia.muted,
                }}
              >
                No active medications yet.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                {activeList.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      padding: 20,
                      borderRadius: helia.radius,
                      background: helia.card,
                      border: `1px solid ${helia.border}`,
                      boxShadow: helia.cardShadow,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 18, color: helia.forest, marginBottom: 8 }}>{m.name}</div>
                    <div style={{ fontSize: 15, marginBottom: 4 }}>
                      <strong>Dosage:</strong> {m.dosage}
                    </div>
                    <div style={{ fontSize: 15, marginBottom: 4 }}>
                      <strong>Frequency:</strong> {m.frequency}
                    </div>
                    <div style={{ fontSize: 15, marginBottom: m.notes ? 8 : 12 }}>
                      <strong>Started:</strong> {m.start_date ? new Date(m.start_date).toLocaleDateString() : '—'}
                    </div>
                    {m.notes && (
                      <div style={{ fontSize: 15, color: helia.body, marginBottom: 12 }}>{m.notes}</div>
                    )}
                    <button
                      type="button"
                      onClick={() => setMedicationActive(m.id, false)}
                      style={{
                        padding: '8px 14px',
                        fontSize: 14,
                        fontWeight: 600,
                        background: helia.cream,
                        color: helia.forest,
                        border: `1px solid ${helia.border}`,
                        borderRadius: helia.radiusSm,
                        cursor: 'pointer',
                        fontFamily: helia.font,
                      }}
                    >
                      Mark inactive / discontinued
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {inactiveList.length > 0 && (
            <section>
              <h2 style={{ color: helia.muted, marginBottom: 14, fontSize: 18, fontWeight: 700 }}>Inactive</h2>
              <div style={{ display: 'grid', gap: 12 }}>
                {inactiveList.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      padding: 16,
                      borderRadius: helia.radius,
                      background: helia.cream,
                      border: `1px dashed ${helia.border}`,
                      opacity: 0.92,
                    }}
                  >
                    <div style={{ fontWeight: 600, color: helia.body }}>{m.name}</div>
                    <div style={{ fontSize: 14, color: helia.muted }}>
                      {m.dosage} · {m.frequency}
                    </div>
                    <button
                      type="button"
                      onClick={() => setMedicationActive(m.id, true)}
                      style={{
                        marginTop: 10,
                        padding: '6px 12px',
                        fontSize: 13,
                        fontWeight: 600,
                        background: helia.sageMuted,
                        color: helia.forest,
                        border: `1px solid rgba(122, 158, 126, 0.35)`,
                        borderRadius: helia.radiusSm,
                        cursor: 'pointer',
                        fontFamily: helia.font,
                      }}
                    >
                      Mark active again
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
