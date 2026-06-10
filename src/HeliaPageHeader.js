import React from 'react';
import { Link } from 'react-router-dom';
import { helia } from './heliaTheme';

export default function HeliaPageHeader({ title, subtitle, breadcrumb, greeting = false }) {
  return (
    <div style={{ padding: '32px 36px 12px' }}>
      {breadcrumb && (
        <div style={{ fontSize: 13, color: helia.muted, marginBottom: 8 }}>
          {breadcrumb.map((item, i) => (
            <span key={item.label}>
              {i > 0 && <span style={{ margin: '0 8px' }}>/</span>}
              {item.to ? (
                <Link to={item.to} style={{ color: helia.sage, textDecoration: 'none', fontWeight: 600 }}>
                  {item.label}
                </Link>
              ) : (
                <span style={{ color: helia.body }}>{item.label}</span>
              )}
            </span>
          ))}
        </div>
      )}
      <h1
        style={{
          margin: 0,
          fontSize: greeting ? '2.2rem' : 30,
          fontWeight: greeting ? 700 : 800,
          color: helia.forest,
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </h1>
      {subtitle && (
        <p style={{ margin: '10px 0 0', color: helia.muted, fontSize: 16, maxWidth: 640, lineHeight: 1.55 }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
