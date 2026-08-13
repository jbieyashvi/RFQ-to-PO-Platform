import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

/**
 * Layout-route guard. Renders protected content only when a mock session
 * exists; otherwise redirects to /login, preserving the attempted path so the
 * user returns there after signing in. Because AuthProvider hydrates from
 * storage synchronously, a refresh on a protected route never flashes blank.
 */
export function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}
