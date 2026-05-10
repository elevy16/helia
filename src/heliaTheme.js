/** Helia design tokens — warm minimal UI */
export const helia = {
  cream: '#faf8f4',
  card: '#ffffff',
  cardShadow: '0 2px 12px rgba(0,0,0,0.06)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.08)',
  sage: '#7a9e7e',
  sageMuted: 'rgba(122, 158, 126, 0.15)',
  forest: '#2d5a27',
  body: '#2c2c2c',
  muted: '#7a7a6e',
  border: '#e8e4de',
  warning: '#d4a843',
  alert: '#c0392b',
  successBg: 'rgba(122, 158, 126, 0.12)',
  warningBg: 'rgba(212, 168, 67, 0.12)',
  alertBg: 'rgba(192, 57, 43, 0.08)',
  radius: 12,
  radiusSm: 10,
  font: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export const heliaInsightColors = {
  alert: {
    dot: helia.alert,
    border: 'rgba(192, 57, 43, 0.35)',
    bg: helia.alertBg,
    label: '#a93226',
  },
  warning: {
    dot: helia.warning,
    border: 'rgba(212, 168, 67, 0.45)',
    bg: helia.warningBg,
    label: '#8a6d1f',
  },
  info: {
    dot: helia.sage,
    border: 'rgba(122, 158, 126, 0.45)',
    bg: helia.successBg,
    label: helia.forest,
  },
};
