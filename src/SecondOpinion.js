import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import HeliaPageHeader from './HeliaPageHeader';
import { helia } from './heliaTheme';
import { heliaPageMainStyle } from './heliaUi';
import {
  BookOpen,
  Flag,
  HeliaIcon,
  HelpCircle,
  ShieldCheck,
  Stethoscope,
} from './heliaIcons';

const HELIA_API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

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

function Section({ title, icon: Icon, children, accent }) {
  return (
    <div
      style={{
        background: helia.card,
        borderRadius: helia.radius,
        padding: '26px 28px',
        border: `1px solid ${helia.border}`,
        boxShadow: helia.cardShadow,
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span
          style={{
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: accent || helia.sageMuted,
            borderRadius: helia.radiusSm,
          }}
          aria-hidden
        >
          <HeliaIcon icon={Icon} size={18} color={helia.sage} strokeWidth={2} />
        </span>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: helia.forest }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function SecondOpinion() {
  const [user, setUser] = useState(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [provider, setProvider] = useState('');
  const [concerns, setConcerns] = useState('');
  const [response, setResponse] = useState(null);
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
    if (!diagnosis.trim() || !provider.trim()) {
      setError('Please describe the diagnosis or treatment and who told you.');
      return;
    }
    setLoading(true);
    setError('');
    setResponse(null);

    try {
      const resp = await fetch(`${HELIA_API_BASE}/api/second-opinion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          diagnosis: diagnosis.trim(),
          provider: provider.trim(),
          concerns: concerns.trim(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Failed to generate guidance');
        return;
      }
      setResponse(data.response);
    } catch (err) {
      setError('Failed to generate guidance: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <HeliaPageHeader
        title="Second Opinion Support"
        subtitle="Understand your diagnosis, know what to ask, and learn when a second opinion may help."
        breadcrumb={[{ label: 'My Care', to: '/second-opinion' }, { label: 'Second Opinion' }]}
      />
      <main style={heliaPageMainStyle}>
          <form
            onSubmit={handleSubmit}
            style={{
              background: helia.card,
              padding: 28,
              borderRadius: helia.radius,
              border: `1px solid ${helia.border}`,
              boxShadow: helia.cardShadow,
              marginBottom: 24,
            }}
          >
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 10, color: helia.forest, fontWeight: 600, fontSize: 15 }}>
                What diagnosis or treatment did you receive?
              </label>
              <textarea
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                disabled={loading}
                style={{ ...fieldStyle, minHeight: 90, resize: 'vertical', opacity: loading ? 0.65 : 1 }}
                placeholder="e.g. Recommended knee replacement surgery for osteoarthritis"
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 10, color: helia.forest, fontWeight: 600, fontSize: 15 }}>
                Who told you this?
              </label>
              <input
                type="text"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                disabled={loading}
                style={{ ...fieldStyle, opacity: loading ? 0.65 : 1 }}
                placeholder="e.g. Dr. Smith, orthopedic surgeon"
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 10, color: helia.forest, fontWeight: 600, fontSize: 15 }}>
                What concerns do you have? (optional)
              </label>
              <textarea
                value={concerns}
                onChange={(e) => setConcerns(e.target.value)}
                disabled={loading}
                style={{ ...fieldStyle, minHeight: 80, resize: 'vertical', opacity: loading ? 0.65 : 1 }}
                placeholder="e.g. I'm worried about recovery time and whether surgery is really necessary"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !user}
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
              {loading ? 'Analyzing…' : 'Get guidance'}
            </button>
          </form>

          {error && (
            <div style={{ marginBottom: 20, color: helia.alert, fontSize: 16 }}>{error}</div>
          )}

          {response && (
            <div>
              <Section title="Understanding your diagnosis or treatment" icon={BookOpen} accent={helia.sageMuted}>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: helia.body, whiteSpace: 'pre-wrap' }}>
                  {response.diagnosisExplanation}
                </p>
              </Section>

              {response.questionsForDoctor && response.questionsForDoctor.length > 0 && (
                <Section title="Questions worth asking your doctor" icon={HelpCircle} accent="rgba(122, 158, 126, 0.18)">
                  <ul style={{ margin: 0, paddingLeft: 22, fontSize: 15, lineHeight: 1.7, color: helia.body }}>
                    {response.questionsForDoctor.map((q, i) => (
                      <li key={i} style={{ marginBottom: 8 }}>{q}</li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="When a second opinion makes sense" icon={Stethoscope} accent="rgba(45, 90, 39, 0.08)">
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: helia.body, whiteSpace: 'pre-wrap' }}>
                  {response.secondOpinionGuidance}
                </p>
              </Section>

              {response.redFlags && response.redFlags.length > 0 && (
                <Section title="Red flags — seek a second opinion sooner" icon={Flag} accent={helia.alertBg}>
                  <ul style={{ margin: 0, paddingLeft: 22, fontSize: 15, lineHeight: 1.7, color: helia.body }}>
                    {response.redFlags.map((flag, i) => (
                      <li key={i} style={{ marginBottom: 8 }}>{flag}</li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="How to advocate for yourself" icon={ShieldCheck} accent={helia.warningBg}>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: helia.body, whiteSpace: 'pre-wrap' }}>
                  {response.selfAdvocacy}
                </p>
              </Section>

              <p style={{ marginTop: 8, fontSize: 13, color: helia.muted, lineHeight: 1.5 }}>
                This guidance is for educational purposes and does not replace professional medical advice. Always consult qualified healthcare providers for medical decisions.
              </p>
            </div>
          )}
      </main>
    </>
  );
}
