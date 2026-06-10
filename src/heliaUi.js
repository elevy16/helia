import { helia } from './heliaTheme';

export const heliaCardStyle = {
  background: helia.card,
  padding: 28,
  borderRadius: helia.radius,
  border: `1px solid ${helia.border}`,
  boxShadow: helia.cardShadow,
  color: helia.body,
};

export const heliaPageMainStyle = {
  padding: '24px 36px 48px',
  maxWidth: 1040,
  width: '100%',
  margin: '0 auto',
  boxSizing: 'border-box',
};

export const heliaFieldStyle = {
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

export function heliaNavLinkStyle(isActive) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px',
    borderRadius: helia.radiusSm,
    fontSize: 14,
    fontWeight: 600,
    color: isActive ? helia.forest : helia.body,
    textDecoration: 'none',
    border: '1px solid transparent',
    background: isActive ? 'rgba(122, 158, 126, 0.08)' : 'transparent',
    transition: 'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
  };
}
