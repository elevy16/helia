import React from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import Dashboard from './Dashboard';
import SignUp from './SignUp';
import Login from './Login';
import RequireAuth from './RequireAuth';
import AppointmentPrep from './AppointmentPrep';
import Timeline from './Timeline';
import AppointmentDebrief from './AppointmentDebrief';
import { helia } from './heliaTheme';

function Home() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: helia.cream,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: helia.font,
        color: helia.body,
        fontSize: 18,
        lineHeight: 1.6,
        padding: 32,
        boxSizing: 'border-box',
      }}
    >
      <svg
        width={64}
        height={76}
        viewBox="0 0 48 58"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        style={{ marginBottom: 20, display: 'block' }}
      >
        <path
          fill="#2d5a27"
          d="M24 2 Q42 24 24 54 Q6 24 24 2 Z"
        />
      </svg>
      <h1
        style={{
          fontSize: 44,
          fontWeight: 800,
          color: helia.forest,
          margin: '0 0 12px',
          letterSpacing: '-0.03em',
          textAlign: 'center',
        }}
      >
        Helia
      </h1>
      <p
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: helia.forest,
          margin: '0 0 18px',
          textAlign: 'center',
          maxWidth: 640,
          lineHeight: 1.3,
        }}
      >
        Know your body. Own your health.
      </p>
      <p
        style={{
          fontSize: 18,
          color: helia.muted,
          maxWidth: 640,
          textAlign: 'center',
          margin: '0 0 40px',
          lineHeight: 1.55,
        }}
      >
        For the first time, your health has an advocate that knows everything about you, never forgets, and is always on your side.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => navigate('/signup')}
          style={{
            padding: '14px 32px',
            fontSize: 17,
            fontWeight: 700,
            backgroundColor: helia.sage,
            color: '#fff',
            border: 'none',
            borderRadius: helia.radiusSm,
            cursor: 'pointer',
            fontFamily: helia.font,
            boxShadow: helia.cardShadow,
          }}
        >
          Sign up
        </button>
        <button
          type="button"
          onClick={() => navigate('/login')}
          style={{
            padding: '14px 32px',
            fontSize: 17,
            fontWeight: 700,
            backgroundColor: 'transparent',
            color: helia.forest,
            border: `2px solid ${helia.sage}`,
            borderRadius: helia.radiusSm,
            cursor: 'pointer',
            fontFamily: helia.font,
          }}
        >
          Log in
        </button>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/appointment-prep" element={<RequireAuth><AppointmentPrep /></RequireAuth>} />
        <Route path="/debrief" element={<RequireAuth><AppointmentDebrief /></RequireAuth>} />
        <Route path="/timeline" element={<RequireAuth><Timeline /></RequireAuth>} />
      </Routes>
    </Router>
  );
}

export default App;
