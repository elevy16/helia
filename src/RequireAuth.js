import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthUser } from './useAuthUser';

export default function RequireAuth({ children }) {
  const { user, loading } = useAuthUser();

  if (loading) return null;

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
