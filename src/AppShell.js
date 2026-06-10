import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import HeliaSidebar from './HeliaSidebar';
import FloatingChat from './FloatingChat';
import { ChatProvider } from './ChatContext';
import { useAuthUser } from './useAuthUser';
import { helia } from './heliaTheme';

export default function AppShell() {
  const { user } = useAuthUser();
  const navigate = useNavigate();

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate('/');
  }

  return (
    <ChatProvider>
      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          background: helia.cream,
          color: helia.body,
          fontFamily: helia.font,
          fontSize: 17,
          lineHeight: 1.55,
        }}
      >
        <HeliaSidebar userEmail={user?.email} onLogout={handleLogout} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Outlet context={{ user }} key={user?.id ?? 'signed-out'} />
        </div>
        <FloatingChat key={user?.id ?? 'signed-out'} user={user} />
      </div>
    </ChatProvider>
  );
}
