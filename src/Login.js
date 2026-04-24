import React, { useState } from 'react';
import { supabase } from './supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // On success, navigate to dashboard
    navigate('/dashboard');
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a2e1a, #162616)',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'sans-serif'
    }}>
      <form onSubmit={handleSubmit} style={{ background: 'rgba(255,255,255,0.03)', padding: 24, borderRadius: 8, width: 360 }}>
        <h2 style={{ marginTop: 0 }}>Log In</h2>
        <label style={{ display: 'block', marginBottom: 8, color: '#a8c5a0' }}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required style={{ width: '100%', padding: 8, marginBottom: 12, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: 'white' }} />

        <label style={{ display: 'block', marginBottom: 8, color: '#a8c5a0' }}>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required style={{ width: '100%', padding: 8, marginBottom: 12, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)', background: 'transparent', color: 'white' }} />

        {error && <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div>}

        <button type="submit" disabled={loading} style={{ width: '100%', padding: 10, backgroundColor: '#6a9e6a', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
