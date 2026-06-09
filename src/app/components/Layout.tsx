import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { SecondarySidebar } from './SecondarySidebar';
import { FullPageLoader } from './DataStates';
import { useAuth } from '../../contexts/AuthContext';

const LAST_ROUTE_KEY = 'deryv.lastRoute';

export function Layout() {
  const { user, loading, orgId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login', { replace: true });
    }
  }, [user, loading, navigate]);

  // Persist current route so it survives refresh
  useEffect(() => {
    if (!loading && user) {
      localStorage.setItem(LAST_ROUTE_KEY, location.pathname);
    }
  }, [location.pathname, loading, user]);

  if (loading) return <FullPageLoader />;
  if (!user) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      <TopBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(c => !c)} />
        <SecondarySidebar />
        <main className="flex-1 overflow-y-auto bg-[#F4F5F6]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
