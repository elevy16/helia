import React from 'react';
import { useNavigate } from 'react-router-dom';
import { helia } from './heliaTheme';

/** Warm layout shell for Timeline, Appointment Prep, Debrief (no sidebar). */
export default function HeliaSubpageChrome({ title, children }) {
  const navigate = useNavigate();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: helia.cream,
        color: helia.body,
        fontFamily: helia.font,
        fontSize: 17,
        lineHeight: 1.55,
      }}
    >
      <header
        style={{
          background: helia.card,
          borderBottom: `1px solid ${helia.border}`,
          boxShadow: helia.cardShadow,
          padding: '18px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: helia.radiusSm,
              background: `linear-gradient(145deg, ${helia.sage}, ${helia.forest})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 15,
            }}
          >
            H
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: helia.sage, letterSpacing: '0.04em' }}>HELIA</div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: helia.forest }}>{title}</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          style={{
            padding: '10px 18px',
            borderRadius: helia.radiusSm,
            border: `1px solid ${helia.border}`,
            background: helia.cream,
            color: helia.forest,
            fontWeight: 600,
            fontSize: 15,
            cursor: 'pointer',
            fontFamily: helia.font,
          }}
        >
          Back to Dashboard
        </button>
      </header>
      <main style={{ padding: '32px 28px 48px', maxWidth: 920, margin: '0 auto' }}>{children}</main>
    </div>
  );
}
