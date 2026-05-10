import React from 'react';
import { NavLink } from 'react-router-dom';
import { helia } from './heliaTheme';

const linkStyle = {
  display: 'block',
  padding: '12px 16px',
  borderRadius: helia.radiusSm,
  fontSize: 15,
  fontWeight: 600,
  color: helia.body,
  textDecoration: 'none',
  border: '1px solid transparent',
};

export default function HeliaSidebar({ userEmail, onLogout }) {
  return (
    <aside
      style={{
        width: 248,
        flexShrink: 0,
        minHeight: '100vh',
        background: helia.card,
        borderRight: `1px solid ${helia.border}`,
        boxShadow: helia.cardShadow,
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ marginBottom: 28, padding: '0 8px' }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: helia.forest,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
          }}
        >
          Helia
        </div>
        <div style={{ fontSize: 12, color: helia.muted, marginTop: 4, lineHeight: 1.4 }}>
          Your health companion
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[
          { to: '/dashboard', label: 'Dashboard' },
          { to: '/timeline', label: 'Timeline' },
          { to: '/symptoms', label: 'Symptom Tracker' },
          { to: '/medications', label: 'Medication Tracker' },
          { to: '/hospital', label: 'Hospital Records' },
          { to: '/appointment-prep', label: 'Appointment Prep' },
          { to: '/debrief', label: 'Appointment Debrief' },
        ].map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/dashboard'}
            style={({ isActive }) => ({
              ...linkStyle,
              background: isActive ? helia.sageMuted : 'transparent',
              borderColor: isActive ? 'rgba(122, 158, 126, 0.35)' : 'transparent',
              color: isActive ? helia.forest : helia.body,
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      {userEmail && (
        <div
          style={{
            fontSize: 12,
            color: helia.muted,
            padding: '12px 8px',
            wordBreak: 'break-all',
            borderTop: `1px solid ${helia.border}`,
            marginBottom: 8,
          }}
        >
          {userEmail}
        </div>
      )}
      <button
        type="button"
        onClick={onLogout}
        style={{
          padding: '12px 16px',
          borderRadius: helia.radiusSm,
          border: `1px solid ${helia.border}`,
          background: helia.cream,
          color: helia.forest,
          fontWeight: 600,
          fontSize: 14,
          cursor: 'pointer',
          fontFamily: helia.font,
        }}
      >
        Log out
      </button>
    </aside>
  );
}
