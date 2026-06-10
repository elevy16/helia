import React from 'react';
import { Link } from 'react-router-dom';
import { helia } from './heliaTheme';
import { getScoreColor } from './HealthScoreWidget';
import { getScoreStatus, getScoreStatusColor } from './heliaIcons';

function CircularProgress({ score, color, size = 72 }) {
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <svg width={size} height={size} style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={helia.border} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x={size / 2}
        y={size / 2 + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fill={helia.forest}
        fontSize={20}
        fontWeight="800"
        fontFamily={helia.font}
      >
        {score}
      </text>
    </svg>
  );
}

export function CompactHealthScore({ scoreData, loading, error, expanded, onToggle }) {
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: helia.muted, fontSize: 13 }}>
        <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
      </div>
    );
  }
  if (error || !scoreData) return null;

  const { score, breakdown } = scoreData;
  const color = getScoreColor(score);
  const status = getScoreStatus(score);
  const statusColor = getScoreStatusColor(score);
  const earned = breakdown.filter((b) => b.earned);
  const missing = breakdown.filter((b) => !b.earned);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={onToggle}
        title="Health Engagement Score — click for details"
        style={{
          border: `1px solid ${helia.border}`,
          background: helia.card,
          borderRadius: helia.radius,
          padding: '10px 12px 8px',
          cursor: 'pointer',
          boxShadow: helia.cardShadow,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <CircularProgress score={score} color={color} size={72} />
        <span style={{ fontSize: 11, fontWeight: 600, color: statusColor, letterSpacing: '0.01em' }}>
          {status}
        </span>
      </button>

      {expanded && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 10,
            width: 340,
            maxWidth: '90vw',
            background: helia.card,
            border: `1px solid ${helia.border}`,
            borderRadius: helia.radius,
            boxShadow: helia.cardShadowHover,
            padding: 28,
            zIndex: 20,
          }}
        >
          <div style={{ fontWeight: 800, color: helia.forest, marginBottom: 6, fontSize: 16 }}>
            Health Engagement Score
          </div>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: helia.muted, lineHeight: 1.5 }}>
            How actively you use Helia — not your medical health status.
          </p>
          {earned.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: helia.forest, marginBottom: 6, textTransform: 'uppercase' }}>
                Contributing
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {earned.map((item) => (
                  <span
                    key={item.key}
                    style={{
                      fontSize: 12,
                      padding: '4px 8px',
                      borderRadius: 6,
                      background: helia.sageMuted,
                      color: helia.forest,
                    }}
                  >
                    ✓ {item.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {missing.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
              {missing.slice(0, 4).map((item) => (
                <li key={item.key} style={{ fontSize: 13, color: helia.body, lineHeight: 1.4 }}>
                  {item.link ? (
                    <Link to={item.link} style={{ color: helia.forest, fontWeight: 600 }} onClick={onToggle}>
                      {item.suggestion}
                    </Link>
                  ) : (
                    item.suggestion
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default CompactHealthScore;
