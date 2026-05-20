import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import HeliaSidebar from './HeliaSidebar';
import { helia } from './heliaTheme';
import {
  buildCardViewModel,
  downloadEmergencyCardPdf,
  formatDisplayDate,
} from './emergencyCardUtils';

const EMPTY_FORM = {
  full_name: '',
  date_of_birth: '',
  blood_type: '',
  allergies: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  primary_doctor_name: '',
  primary_doctor_phone: '',
};

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  background: helia.cream,
  border: `1px solid ${helia.border}`,
  borderRadius: helia.radiusSm,
  color: helia.body,
  fontSize: 15,
  fontFamily: helia.font,
  outline: 'none',
};

function CardSection({ title, children, highlight }) {
  return (
    <div
      style={{
        marginBottom: 14,
        paddingBottom: 12,
        borderBottom: '1px solid #ccc',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: highlight ? '#000' : '#333',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: '#111' }}>{children}</div>
    </div>
  );
}

function BulletList({ items, emptyLabel = 'None recorded' }) {
  if (!items || items.length === 0) {
    return <span style={{ color: '#555' }}>{emptyLabel}</span>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: 4 }}>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function EmergencyCard() {
  const [user, setUser] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [savedRow, setSavedRow] = useState(null);
  const [fhirData, setFhirData] = useState(null);
  const [trackerMeds, setTrackerMeds] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const prefilledRef = useRef(false);
  const navigate = useNavigate();

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  const loadData = useCallback(async (userId) => {
    setLoading(true);
    setError('');
    try {
      const [cardRes, hospitalRes, medsRes, docsRes] = await Promise.all([
        supabase.from('emergency_cards').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('hospital_connections').select('fhir_data').eq('user_id', userId).maybeSingle(),
        supabase
          .from('medications')
          .select('name, dosage, frequency, active')
          .eq('user_id', userId)
          .eq('active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('document_texts')
          .select('filename, red_flags')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
      ]);

      if (cardRes.error && cardRes.error.code !== 'PGRST116') {
        throw new Error(cardRes.error.message);
      }
      if (hospitalRes.error) throw new Error(hospitalRes.error.message);
      if (medsRes.error) throw new Error(medsRes.error.message);
      if (docsRes.error) throw new Error(docsRes.error.message);

      const row = cardRes.data;
      setSavedRow(row);
      setFhirData(hospitalRes.data?.fhir_data || null);
      setTrackerMeds(medsRes.data || []);
      setDocuments(docsRes.data || []);

      if (row) {
        setForm({
          full_name: row.full_name || '',
          date_of_birth: row.date_of_birth || '',
          blood_type: row.blood_type || '',
          allergies: row.allergies || '',
          emergency_contact_name: row.emergency_contact_name || '',
          emergency_contact_phone: row.emergency_contact_phone || '',
          primary_doctor_name: row.primary_doctor_name || '',
          primary_doctor_phone: row.primary_doctor_phone || '',
        });
      } else {
        setForm(EMPTY_FORM);
      }
    } catch (err) {
      setError('Failed to load emergency card: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      const { data } = await supabase.auth.getUser();
      const u = data.user || null;
      setUser(u);
      if (u) await loadData(u.id);
      else setLoading(false);
    }
    init();
  }, [loadData]);

  const card = useMemo(() => {
    const saved = {
      ...form,
      updated_at: savedRow?.updated_at || null,
    };
    return buildCardViewModel(saved, fhirData, trackerMeds, documents);
  }, [form, savedRow, fhirData, trackerMeds, documents]);

  useEffect(() => {
    if (loading || savedRow || prefilledRef.current) return;
    if (!fhirData && trackerMeds.length === 0) return;
    prefilledRef.current = true;
    const fhirHints = buildCardViewModel(EMPTY_FORM, fhirData, trackerMeds, documents);
    setForm((prev) => ({
      full_name: prev.full_name || fhirHints.fullName || '',
      date_of_birth: prev.date_of_birth || fhirHints.dateOfBirth || '',
      blood_type: prev.blood_type || '',
      allergies: prev.allergies || (fhirHints.allergies.length ? fhirHints.allergies.join(', ') : ''),
      emergency_contact_name: prev.emergency_contact_name || '',
      emergency_contact_phone: prev.emergency_contact_phone || '',
      primary_doctor_name: prev.primary_doctor_name || fhirHints.primaryDoctorName || '',
      primary_doctor_phone: prev.primary_doctor_phone || '',
    }));
  }, [loading, savedRow, fhirData, trackerMeds, documents]);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        user_id: user.id,
        full_name: form.full_name.trim(),
        date_of_birth: form.date_of_birth || null,
        blood_type: form.blood_type.trim(),
        allergies: form.allergies.trim(),
        emergency_contact_name: form.emergency_contact_name.trim(),
        emergency_contact_phone: form.emergency_contact_phone.trim(),
        primary_doctor_name: form.primary_doctor_name.trim(),
        primary_doctor_phone: form.primary_doctor_phone.trim(),
        updated_at: new Date().toISOString(),
      };

      const { data, error: upsertErr } = await supabase
        .from('emergency_cards')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single();

      if (upsertErr) throw new Error(upsertErr.message);
      setSavedRow(data);
      setMessage('Emergency card saved.');
    } catch (err) {
      setError('Could not save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  async function handleDownloadPdf() {
    setDownloading(true);
    setError('');
    try {
      await downloadEmergencyCardPdf({
        ...card,
        lastUpdated: savedRow?.updated_at || new Date().toISOString(),
      });
    } catch (err) {
      setError('PDF download failed: ' + err.message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="emergency-card-page"
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
      <div className="no-print">
        <HeliaSidebar userEmail={user?.email} onLogout={handleLogout} />
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="no-print" style={{ padding: '28px 36px 8px' }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: helia.forest, letterSpacing: '-0.02em' }}>
            Emergency Health Card
          </h1>
          <p style={{ margin: '10px 0 0', color: helia.muted, fontSize: 16 }}>
            A one-page summary for first responders or a new doctor. Pre-filled from your Helia records where possible.
          </p>
        </div>

        <main style={{ padding: '12px 36px 48px', maxWidth: 960, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {loading ? (
            <div className="no-print" style={{ color: helia.muted, display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
              Loading your emergency card…
            </div>
          ) : (
            <>
              <form
                className="no-print"
                onSubmit={handleSave}
                style={{
                  background: helia.card,
                  padding: 24,
                  borderRadius: helia.radius,
                  border: `1px solid ${helia.border}`,
                  boxShadow: helia.cardShadow,
                  marginBottom: 24,
                }}
              >
                <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: helia.forest }}>
                  Your details
                </h2>
                <p style={{ margin: '0 0 20px', fontSize: 14, color: helia.muted }}>
                  Diagnoses, medications, and critical notes are pulled automatically from your records.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                  {[
                    { key: 'full_name', label: 'Full name', type: 'text', placeholder: 'Jane Doe' },
                    { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
                    { key: 'blood_type', label: 'Blood type', type: 'text', placeholder: 'O+' },
                    { key: 'emergency_contact_name', label: 'Emergency contact name', type: 'text' },
                    { key: 'emergency_contact_phone', label: 'Emergency contact phone', type: 'tel' },
                    { key: 'primary_doctor_name', label: 'Primary doctor name', type: 'text' },
                    { key: 'primary_doctor_phone', label: 'Primary doctor phone', type: 'tel' },
                  ].map(({ key, label, type, placeholder }) => (
                    <div key={key}>
                      <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600, color: helia.forest }}>
                        {label}
                      </label>
                      <input
                        type={type}
                        value={form[key]}
                        onChange={(e) => updateField(key, e.target.value)}
                        placeholder={placeholder}
                        style={fieldStyle}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 16 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600, color: helia.forest }}>
                    Known allergies (add any not from hospital records)
                  </label>
                  <textarea
                    value={form.allergies}
                    onChange={(e) => updateField('allergies', e.target.value)}
                    placeholder="e.g. Penicillin, shellfish"
                    style={{ ...fieldStyle, minHeight: 72, resize: 'vertical' }}
                  />
                </div>

                <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{
                      padding: '12px 22px',
                      background: saving ? helia.sageMuted : helia.sage,
                      color: '#fff',
                      border: 'none',
                      borderRadius: helia.radiusSm,
                      fontWeight: 700,
                      cursor: saving ? 'not-allowed' : 'pointer',
                      fontFamily: helia.font,
                    }}
                  >
                    {saving ? 'Saving…' : 'Save card'}
                  </button>
                  {message && <span style={{ color: helia.forest, fontSize: 14, fontWeight: 600 }}>{message}</span>}
                </div>
              </form>

              {error && (
                <div className="no-print" style={{ color: helia.alert, marginBottom: 16, fontSize: 15 }}>
                  {error}
                </div>
              )}

              <div className="no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={handlePrint}
                  style={{
                    padding: '12px 20px',
                    background: helia.forest,
                    color: '#fff',
                    border: 'none',
                    borderRadius: helia.radiusSm,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: helia.font,
                  }}
                >
                  Print
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={downloading}
                  style={{
                    padding: '12px 20px',
                    background: helia.card,
                    color: helia.forest,
                    border: `2px solid ${helia.sage}`,
                    borderRadius: helia.radiusSm,
                    fontWeight: 700,
                    cursor: downloading ? 'not-allowed' : 'pointer',
                    fontFamily: helia.font,
                  }}
                >
                  {downloading ? 'Generating PDF…' : 'Download as PDF'}
                </button>
                <span style={{ fontSize: 14, color: helia.muted }}>
                  Last updated: {formatDisplayDate(savedRow?.updated_at) || 'Not saved yet'}
                </span>
              </div>

              <div
                id="emergency-card-printable"
                className="emergency-card-printable"
                style={{
                  background: '#fff',
                  color: '#000',
                  border: '2px solid #000',
                  borderRadius: helia.radius,
                  padding: '28px 32px',
                  maxWidth: 720,
                  margin: '0 auto',
                  boxShadow: helia.cardShadow,
                }}
              >
                <div style={{ textAlign: 'center', marginBottom: 20, borderBottom: '2px solid #000', paddingBottom: 16 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: '#000',
                      marginBottom: 6,
                    }}
                  >
                    In Case of Emergency
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#000', letterSpacing: '-0.02em' }}>
                    {card.fullName || 'Patient name not set'}
                  </div>
                  <div style={{ fontSize: 13, color: '#333', marginTop: 6 }}>
                    DOB: {formatDisplayDate(card.dateOfBirth)} · Blood type: {card.bloodType || '—'}
                  </div>
                </div>

                <CardSection title="Active diagnoses">
                  <BulletList items={card.diagnoses} />
                </CardSection>

                <CardSection title="Current medications">
                  <BulletList items={card.medications} />
                </CardSection>

                <CardSection title="Known allergies" highlight>
                  <BulletList items={card.allergies} emptyLabel="None recorded — confirm with patient" />
                </CardSection>

                <CardSection title="Emergency contact">
                  {card.emergencyContactName || card.emergencyContactPhone ? (
                    <>
                      <strong>{card.emergencyContactName || '—'}</strong>
                      {card.emergencyContactPhone && (
                        <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700 }}>{card.emergencyContactPhone}</div>
                      )}
                    </>
                  ) : (
                    <span style={{ color: '#555' }}>Not provided</span>
                  )}
                </CardSection>

                <CardSection title="Primary doctor">
                  {card.primaryDoctorName || card.primaryDoctorPhone ? (
                    <>
                      {card.primaryDoctorName || '—'}
                      {card.primaryDoctorPhone && <div style={{ marginTop: 4 }}>{card.primaryDoctorPhone}</div>}
                    </>
                  ) : (
                    <span style={{ color: '#555' }}>Not provided</span>
                  )}
                </CardSection>

                <CardSection title="Critical health notes">
                  <BulletList items={card.criticalNotes} />
                </CardSection>

                <div style={{ fontSize: 11, color: '#555', marginTop: 8, textAlign: 'center' }}>
                  Generated by Helia · Last updated {formatDisplayDate(savedRow?.updated_at) || 'draft'} ·
                  Not a substitute for official medical records
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
