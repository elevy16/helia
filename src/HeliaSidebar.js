import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import HeliaLeafIcon from './HeliaLeafIcon';
import { helia } from './heliaTheme';
import { heliaNavLinkStyle } from './heliaUi';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  HeliaIcon,
  LogOut,
  NAV_ICONS,
} from './heliaIcons';

const SIDEBAR_WIDE = 248;
const SIDEBAR_RAIL = 68;

const NAV_GROUPS = [
  {
    id: 'myHealth',
    label: 'My Health',
    defaultOpen: true,
    items: [
      { to: '/dashboard', label: 'Dashboard', end: true },
      { to: '/alerts', label: 'Health Alerts' },
      { to: '/timeline', label: 'Timeline' },
      { to: '/narrative', label: 'My Health Story' },
    ],
  },
  {
    id: 'myRecords',
    label: 'My Records',
    defaultOpen: false,
    items: [
      { to: '/documents', label: 'Documents' },
      { to: '/hospital', label: 'Hospital Records' },
      { to: '/emergency-card', label: 'Emergency Card' },
    ],
  },
  {
    id: 'myCare',
    label: 'My Care',
    defaultOpen: false,
    items: [
      { to: '/appointment-prep', label: 'Appointment Prep' },
      { to: '/debrief', label: 'Appointment Debrief' },
      { to: '/second-opinion', label: 'Second Opinion' },
    ],
  },
  {
    id: 'track',
    label: 'Track',
    defaultOpen: false,
    items: [
      { to: '/symptoms', label: 'Symptom Tracker' },
      { to: '/medications', label: 'Medication Tracker' },
      { to: '/lifestyle', label: 'Nutrition & Lifestyle' },
    ],
  },
];

const LS_GROUPS = 'helia.sidebar.groups.v2';
const LS_COLLAPSED = 'helia.sidebar.collapsed';

function loadGroupState() {
  const defaults = Object.fromEntries(NAV_GROUPS.map((g) => [g.id, g.defaultOpen]));
  try {
    const raw = localStorage.getItem(LS_GROUPS);
    if (raw) {
      const parsed = JSON.parse(raw);
      return NAV_GROUPS.reduce((acc, g) => {
        acc[g.id] = typeof parsed[g.id] === 'boolean' ? parsed[g.id] : g.defaultOpen;
        return acc;
      }, {});
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

function NavItem({ item, rail }) {
  const Icon = NAV_ICONS[item.to];
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={item.label}
      className="helia-nav-link"
      style={({ isActive }) => ({
        ...heliaNavLinkStyle(isActive),
        justifyContent: rail ? 'center' : 'flex-start',
        padding: rail ? '12px 8px' : '12px 14px',
      })}
    >
      <HeliaIcon
        icon={Icon}
        size={18}
        color={helia.sage}
        style={{ flexShrink: 0, display: 'block' }}
      />
      {!rail && <span>{item.label}</span>}
    </NavLink>
  );
}

export default function HeliaSidebar({ userEmail, onLogout }) {
  const [groupOpen, setGroupOpen] = useState(loadGroupState);
  const [rail, setRail] = useState(() => localStorage.getItem(LS_COLLAPSED) === 'true');

  useEffect(() => {
    localStorage.setItem(LS_GROUPS, JSON.stringify(groupOpen));
  }, [groupOpen]);

  useEffect(() => {
    localStorage.setItem(LS_COLLAPSED, rail ? 'true' : 'false');
  }, [rail]);

  function toggleGroup(id) {
    setGroupOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const width = rail ? SIDEBAR_RAIL : SIDEBAR_WIDE;

  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        minHeight: '100vh',
        background: helia.card,
        borderRight: `1px solid ${helia.border}`,
        boxShadow: helia.cardShadow,
        display: 'flex',
        flexDirection: 'column',
        padding: rail ? '20px 10px' : '24px 16px',
        boxSizing: 'border-box',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: rail ? 'center' : 'space-between',
          marginBottom: rail ? 20 : 24,
          padding: rail ? 0 : '0 8px',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <HeliaLeafIcon height={rail ? 20 : 24} />
          {!rail && (
            <div style={{ minWidth: 0 }}>
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
          )}
        </div>
        {!rail && (
          <button
            type="button"
            onClick={() => setRail(true)}
            title="Collapse sidebar"
            style={{
              border: `1px solid ${helia.border}`,
              background: helia.cream,
              borderRadius: 8,
              padding: '6px 8px',
              cursor: 'pointer',
              color: helia.muted,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>

      {rail && (
        <button
          type="button"
          onClick={() => setRail(false)}
          title="Expand sidebar"
          style={{
            border: `1px solid ${helia.border}`,
            background: helia.cream,
            borderRadius: 8,
            padding: '8px',
            cursor: 'pointer',
            color: helia.muted,
            marginBottom: 16,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronRight size={16} strokeWidth={2} aria-hidden />
        </button>
      )}

      <nav style={{ display: 'flex', flexDirection: 'column', gap: rail ? 8 : 4, flex: 1, overflowY: 'auto' }}>
        {rail ? (
          NAV_GROUPS.flatMap((g) => g.items).map((item) => <NavItem key={item.to} item={item} rail />)
        ) : (
          NAV_GROUPS.map((group) => {
            const open = !!groupOpen[group.id];
            return (
              <div key={group.id} style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontFamily: helia.font,
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'rgba(122, 122, 110, 0.75)',
                    borderRadius: helia.radiusSm,
                  }}
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    size={12}
                    strokeWidth={2}
                    aria-hidden
                    style={{
                      transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 0.15s ease',
                      opacity: 0.7,
                    }}
                  />
                </button>
                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                    {group.items.map((item) => (
                      <NavItem key={item.to} item={item} rail={false} />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </nav>

      {!rail && userEmail && (
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
        title="Log out"
        style={{
          padding: rail ? '10px 8px' : '12px 16px',
          borderRadius: helia.radiusSm,
          border: `1px solid ${helia.border}`,
          background: helia.cream,
          color: helia.forest,
          fontWeight: 600,
          fontSize: 14,
          cursor: 'pointer',
          fontFamily: helia.font,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {rail ? <LogOut size={18} strokeWidth={2} aria-hidden /> : 'Log out'}
      </button>
    </aside>
  );
}
