import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import { useNavigate, Link } from 'react-router-dom';
import { helia } from './heliaTheme';

function formatSignUpError(signErr, attemptedEmail) {
  const code = signErr?.code || '';
  const msg = signErr?.message || '';

  if (code === 'over_email_send_rate_limit' || /rate limit|rate exceeded/i.test(msg)) {
    return (
      'Supabase has temporarily blocked signup emails (about 3 per hour on the free built-in mailer). ' +
      'Wait an hour and try again, log in if the account was already created, or in Supabase go to ' +
      'Authentication → Providers → Email and turn off “Confirm email” for local testing.'
    );
  }

  if (code === 'email_address_not_authorized') {
    return (
      'This email cannot receive a confirmation message with Supabase’s default mailer. ' +
      'Use an email on your Supabase org team, set up custom SMTP, or turn off “Confirm email” under Authentication → Providers → Email.'
    );
  }

  if (code === 'validation_failed' || /invalid format/i.test(msg)) {
    return 'That email has an invalid format — often caused by an extra space from autofill. Please retype it and try again.';
  }

  if (code === 'email_address_invalid') {
    return `Supabase rejected “${attemptedEmail}”. Test domains like @example.com are blocked; otherwise retype the address carefully and try again.`;
  }

  return msg || 'Sign up failed.';
}

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      // Only clear an existing session when one is active (avoids extra auth calls).
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        await supabase.auth.signOut();
      }

      // Pass email through as-is except trimming whitespace (autofill often adds trailing spaces).
      const signupEmail = email.trim();

      const { data, error: signErr } = await supabase.auth.signUp({
        email: signupEmail,
        password,
      });

      if (signErr) {
        setError(formatSignUpError(signErr, signupEmail));
        return;
      }

      if (data.session) {
        navigate('/dashboard');
        return;
      }

      navigate('/login');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '14px 16px',
    marginBottom: 4,
    borderRadius: helia.radiusSm,
    border: `1px solid ${helia.border}`,
    background: helia.cream,
    color: helia.body,
    fontSize: 16,
    fontFamily: helia.font,
    outline: 'none',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: helia.cream,
        color: helia.body,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: helia.font,
        fontSize: 17,
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: helia.card,
          padding: 36,
          borderRadius: helia.radius,
          boxShadow: helia.cardShadow,
          border: `1px solid ${helia.border}`,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              display: 'inline-flex',
              width: 48,
              height: 48,
              borderRadius: 12,
              background: `linear-gradient(145deg, ${helia.sage}, ${helia.forest})`,
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 20,
              marginBottom: 12,
            }}
          >
            H
          </div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: helia.forest }}>Create your account</h1>
          <p style={{ margin: '10px 0 0', color: helia.muted, fontSize: 15 }}>Join Helia</p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', marginBottom: 8, color: helia.forest, fontWeight: 600, fontSize: 14 }}>
            Email
          </label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={(e) => setEmail(e.target.value.trim())}
            type="email"
            autoComplete="email"
            required
            style={{ ...inputStyle, marginBottom: 18 }}
          />

          <label style={{ display: 'block', marginBottom: 8, color: helia.forest, fontWeight: 600, fontSize: 14 }}>
            Password
          </label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            style={{ ...inputStyle, marginBottom: 20 }}
          />

          {error && (
            <div style={{ color: helia.alert, marginBottom: 16, fontSize: 15 }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: 14,
              backgroundColor: loading ? helia.sageMuted : helia.sage,
              color: '#fff',
              border: 'none',
              borderRadius: helia.radiusSm,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              fontSize: 17,
              fontFamily: helia.font,
            }}
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={{ marginTop: 24, textAlign: 'center', color: helia.muted, fontSize: 15 }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: helia.forest, fontWeight: 700 }}>
            Log in
          </Link>
        </p>
        <p style={{ marginTop: 12, textAlign: 'center' }}>
          <Link to="/" style={{ color: helia.muted, fontSize: 14 }}>
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
