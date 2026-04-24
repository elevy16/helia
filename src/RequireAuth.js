import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { Navigate } from 'react-router-dom';

export default function RequireAuth({ children }) {
  const [loading, setLoading] = useState(true);
  const [isAuth, setIsAuth] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function check() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setIsAuth(!!data.session);
      setLoading(false);
    }

    check();

    return () => { mounted = false; };
  }, []);

  if (loading) return null; // or a spinner

  if (!isAuth) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
