import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { parseSummaryMarkdown } from './markdownSummary';

export default function AppointmentPrep() {
  const [user, setUser] = useState(null);
  const [doctorName, setDoctorName] = useState('');
  const [reason, setReason] = useState('');
  const [prepSummary, setPrepSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

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

  const handleBack = () => {
    navigate('/dashboard');
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a2e1a, #162616)',
      color: 'white',
      fontFamily: 'sans-serif'
    }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 36px',
        borderBottom: '1px solid rgba(255,255,255,0.05)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 8,
            backgroundColor: '#6a9e6a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 12,
            fontWeight: 'bold'
          }}>MA</div>
          <h2 style={{ margin: 0 }}>MedAdvocate - Appointment Prep</h2>
        </div>
        <button onClick={handleBack} style={{
          padding: '8px 12px',
          background: 'transparent',
          color: '#a8c5a0',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 6,
          cursor: 'pointer'
        }}>
          Back to Dashboard
        </button>
      </header>

      <main style={{ padding: '28px 36px', maxWidth: 800 }}>
        <h3 style={{ color: '#a8c5a0', marginBottom: 20 }}>Prepare for Your Appointment</h3>

        <form onSubmit={handleSubmit} style={{
          background: 'rgba(22, 38, 22, 0.45)',
          padding: 22,
          borderRadius: 12,
          border: '1px solid rgba(106, 158, 106, 0.16)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
          color: '#e8f0e8',
        }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 8, color: '#a8c5a0' }}>
              Who are you seeing? (e.g., Dr. Smith, Cardiologist)
            </label>
            <input
              type="text"
              value={doctorName}
              onChange={(e) => setDoctorName(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 14px',
                background: 'rgba(0, 0, 0, 0.2)',
                border: '1px solid rgba(106, 158, 106, 0.22)',
                borderRadius: 8,
                color: '#e8f0e8',
                fontSize: 16,
                outline: 'none',
                opacity: loading ? 0.65 : 1,
              }}
              placeholder="Enter doctor name or type"
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, color: '#a8c5a0' }}>
              Why are you seeing them? (reason for visit)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 14px',
                background: 'rgba(0, 0, 0, 0.2)',
                border: '1px solid rgba(106, 158, 106, 0.22)',
                borderRadius: 8,
                color: '#e8f0e8',
                fontSize: 16,
                minHeight: 88,
                resize: 'vertical',
                outline: 'none',
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
                padding: '12px 22px',
                backgroundColor: loading ? 'rgba(106, 158, 106, 0.45)' : '#6a9e6a',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 16,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              {loading && <span className="ma-spinner ma-spinner--sm" style={{ borderTopColor: 'rgba(255,255,255,0.9)' }} aria-hidden />}
              {loading ? 'Generating…' : 'Generate Prep Summary'}
            </button>
            {loading && (
              <span style={{ fontSize: 14, color: '#9fb89f' }}>Building your prep summary — this can take a few seconds.</span>
            )}
          </div>
        </form>

        {error && <div style={{ marginTop: 20, color: '#ffb3b3' }}>{error}</div>}

        {prepSummary && (
          <div
            style={{
              marginTop: 22,
              borderRadius: 12,
              padding: '16px 18px',
              background: 'rgba(22, 38, 22, 0.55)',
              border: '1px solid rgba(106, 158, 106, 0.2)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.14)',
              color: '#e8f0e8',
            }}
          >
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(160deg, #2d4a2d, #1a301a)',
                  borderRadius: 10,
                  fontSize: 22,
                  border: '1px solid rgba(106, 158, 106, 0.22)',
                }}
              >
                📋
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    color: '#e8f0e8',
                    letterSpacing: '0.02em',
                    lineHeight: 1.35,
                    marginBottom: 4,
                  }}
                >
                  Your appointment prep summary
                </div>
                <div
                  style={{
                    fontSize: 15,
                    lineHeight: 1.55,
                    wordBreak: 'break-word',
                    color: '#c8dcc8',
                  }}
                >
                  {parseSummaryMarkdown(prepSummary, 'appointment-prep')}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}