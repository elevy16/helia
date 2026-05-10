import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { parseSummaryMarkdown } from './markdownSummary';
import HeliaSubpageChrome from './HeliaSubpageChrome';
import { helia } from './heliaTheme';

export default function AppointmentPrep() {
  const [user, setUser] = useState(null);
  const [doctorName, setDoctorName] = useState('');
  const [reason, setReason] = useState('');
  const [prepSummary, setPrepSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchUser() {
      const { data } = await supabase.auth.getUser();
      setUser(data.user || null);
    }
    fetchUser();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!doctorName.trim() || !reason.trim()) {
      setError('Please fill in both fields.');
      return;
    }
    setLoading(true);
    setError('');
    setPrepSummary('');

    try {
      const response = await fetch('http://localhost:3001/api/appointment-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          doctorName: doctorName.trim(),
          reason: reason.trim(),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setPrepSummary(data.summary);
      } else {
        const errData = await response.json();
        setError('Error generating prep summary: ' + (errData.error || 'Unknown error'));
      }
    } catch (err) {
      setError('Failed to generate prep summary: ' + err.message);
    }
    setLoading(false);
  };

  const fieldStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '14px 16px',
    background: helia.cream,
    border: `1px solid ${helia.border}`,
    borderRadius: helia.radiusSm,
    color: helia.body,
    fontSize: 16,
    fontFamily: helia.font,
    outline: 'none',
  };

  return (
    <HeliaSubpageChrome title="Appointment Prep">
      <p style={{ color: helia.muted, marginTop: 0, marginBottom: 28, fontSize: 17 }}>
        Prepare for your visit with a personalized summary based on your records.
      </p>

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
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 10, color: helia.forest, fontWeight: 600, fontSize: 15 }}>
            Who are you seeing? (e.g., Dr. Smith, Cardiologist)
          </label>
          <input
            type="text"
            value={doctorName}
            onChange={(e) => setDoctorName(e.target.value)}
            disabled={loading}
            style={{ ...fieldStyle, opacity: loading ? 0.65 : 1 }}
            placeholder="Enter doctor name or type"
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', marginBottom: 10, color: helia.forest, fontWeight: 600, fontSize: 15 }}>
            Why are you seeing them? (reason for visit)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={loading}
            style={{
              ...fieldStyle,
              minHeight: 100,
              resize: 'vertical',
              opacity: loading ? 0.65 : 1,
            }}
            placeholder="Describe the reason for your appointment"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '14px 24px',
              backgroundColor: loading ? helia.sageMuted : helia.sage,
              color: '#fff',
              border: 'none',
              borderRadius: helia.radiusSm,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 17,
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: helia.font,
            }}
          >
            {loading && <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />}
            {loading ? 'Generating…' : 'Generate prep summary'}
          </button>
          {loading && (
            <span style={{ fontSize: 15, color: helia.muted }}>This can take a few seconds.</span>
          )}
        </div>
      </form>

      {error && (
        <div style={{ marginTop: 22, color: helia.alert, fontSize: 16 }}>{error}</div>
      )}

      {prepSummary && (
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
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div
              style={{
                width: 48,
                height: 48,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: `linear-gradient(145deg, ${helia.sage}, ${helia.forest})`,
                borderRadius: helia.radiusSm,
                fontSize: 22,
                border: `1px solid ${helia.border}`,
              }}
            >
              📋
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 17,
                  color: helia.forest,
                  marginBottom: 10,
                }}
              >
                Your appointment prep summary
              </div>
              <div style={{ fontSize: 16, lineHeight: 1.6, wordBreak: 'break-word', color: helia.body }}>
                {parseSummaryMarkdown(prepSummary, 'appointment-prep')}
              </div>
            </div>
          </div>
        </div>
      )}
    </HeliaSubpageChrome>
  );
}
