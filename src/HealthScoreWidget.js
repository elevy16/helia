import React from 'react';
import { Link } from 'react-router-dom';
import { helia } from './heliaTheme';

function getScoreColor(score) {
  if (score >= 70) return helia.sage;
  if (score >= 40) return helia.warning;
  return helia.alert;
}

function CircularProgress({ score, color, size = 128 }) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <svg width={size} height={size} style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={helia.border}
        strokeWidth={stroke}
      />
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
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
      <text
        x={size / 2}
        y={size / 2 - 6}
        textAnchor="middle"
        dominantBaseline="central"
        fill={helia.forest}
        fontSize={32}
        fontWeight="800"
        fontFamily={helia.font}
      >
        {score}
      </text>
      <text
        x={size / 2}
        y={size / 2 + 18}
        textAnchor="middle"
        dominantBaseline="central"
        fill={helia.muted}
        fontSize={12}
        fontWeight="600"
        fontFamily={helia.font}
      >
        / 100
      </text>
    </svg>
  );
}

export default function HealthScoreWidget({ scoreData, loading, error }) {
  if (loading) {
    return (
      <section style={{ marginBottom: 36 }}>
        <div
          style={{
            background: helia.card,
            padding: 28,
            borderRadius: helia.radius,
            border: `1px solid ${helia.border}`,
            boxShadow: helia.cardShadow,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            color: helia.muted,
            fontSize: 15,
          }}
        >
          <span className="ma-spinner ma-spinner--sm ma-spinner--on-light" aria-hidden />
          Calculating your engagement score…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section style={{ marginBottom: 36 }}>
        <div
          style={{
            background: helia.card,
            padding: 20,
            borderRadius: helia.radius,
            border: `1px solid ${helia.border}`,
            color: helia.alert,
            fontSize: 15,
          }}
        >
          {error}
        </div>
      </section>
    );
  }

  if (!scoreData) return null;

  const { score, breakdown } = scoreData;
  const color = getScoreColor(score);
  const earned = breakdown.filter((b) => b.earned);
  const missing = breakdown.filter((b) => !b.earned);

  return (
    <section style={{ marginBottom: 36 }}>
      <div
        style={{
          background: helia.card,
          padding: '28px 32px',
          borderRadius: helia.radius,
          border: `1px solid ${helia.border}`,
          boxShadow: helia.cardShadow,
        }}
      >
        <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <CircularProgress score={score} color={color} />
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color,
              }}
            >
              {score >= 70 ? 'Engaged' : score >= 40 ? 'Getting started' : 'Just beginning'}
            </span>
          </div>

          <div style={{ flex: 1, minWidth: 240 }}>
            <h2
              style={{
                margin: '0 0 6px',
                fontSize: 22,
                fontWeight: 800,
                color: helia.forest,
                letterSpacing: '-0.02em',
              }}
            >
              Health Engagement Score
            </h2>
            <p style={{ margin: '0 0 18px', fontSize: 14, color: helia.muted, lineHeight: 1.55, maxWidth: 520 }}>
              This score reflects how actively you use Helia — not your medical health status. The more you
              engage, the more personalized support Helia can offer.
            </p>

            {earned.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: helia.forest,
                    marginBottom: 8,
                  }}
                >
                  Contributing ({earned.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {earned.map((item) => (
                    <span
                      key={item.key}
                      style={{
                        fontSize: 13,
                        padding: '5px 10px',
                        borderRadius: 8,
                        background: helia.sageMuted,
                        color: helia.forest,
                        fontWeight: 600,
                        border: `1px solid rgba(122, 158, 126, 0.35)`,
                      }}
                    >
                      ✓ {item.label} (+{item.points})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {missing.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: helia.muted,
                    marginBottom: 8,
                  }}
                >
                  Ways to boost your score
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                  {missing.map((item) => (
                    <li
                      key={item.key}
                      style={{
                        fontSize: 14,
                        color: helia.body,
                        lineHeight: 1.45,
                        padding: '10px 14px',
                        background: helia.cream,
                        borderRadius: helia.radiusSm,
                        border: `1px solid ${helia.border}`,
                      }}
                    >
                      <span style={{ color: helia.muted }}>+{item.maxPoints - item.points} pts — </span>
                      {item.link ? (
                        <Link
                          to={item.link}
                          style={{ color: helia.forest, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}
                        >
                          {item.suggestion}
                        </Link>
                      ) : (
                        item.suggestion
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export { getScoreColor };
