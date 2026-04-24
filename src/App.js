import React from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import Dashboard from './Dashboard';
import SignUp from './SignUp';
import Login from './Login';
import RequireAuth from './RequireAuth';
import AppointmentPrep from './AppointmentPrep';
import Timeline from './Timeline';
import AppointmentDebrief from './AppointmentDebrief';

function Home() {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a2e1a, #162616)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'sans-serif',
      color: 'white'
    }}>
      <h1 style={{ fontSize: '48px', marginBottom: '10px', letterSpacing: '1px' }}>
        MedAdvocate
      </h1>
      <p style={{ fontSize: '18px', color: '#a8c5a0', maxWidth: '500px', textAlign: 'center', marginBottom: '40px' }}>
        Your personal AI medical companion. Upload your health documents and chat with an AI that actually knows your history.
      </p>
      <div>
        <button
          onClick={() => navigate('/signup')}
          style={{
            padding: '12px 28px',
            fontSize: '16px',
            marginRight: '12px',
            backgroundColor: '#6a9e6a',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer'
          }}>
          Sign Up
        </button>
        <button
          onClick={() => navigate('/login')}
          style={{
            padding: '12px 28px',
            fontSize: '16px',
            backgroundColor: 'transparent',
            color: 'white',
            border: '2px solid #6a9e6a',
            borderRadius: '8px',
            cursor: 'pointer'
          }}>
          Log In
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