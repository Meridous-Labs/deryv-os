import { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation, useParams } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { SecondarySidebar } from './SecondarySidebar';
import { FullPageLoader } from './DataStates';
import { useAuth } from '../../contexts/AuthContext';
import { Menu, X, ChevronDown } from 'lucide-react';

const LAST_ROUTE_KEY = 'deryv.lastRoute';

// Secondary nav config mirrored here so the mobile dropdown can read it
// without coupling into SecondarySidebar's internals
interface NavItem { id: string; label: string; }
type NavSection = { heading?: string; items: NavItem[] };

const secondaryNavConfig: Record<string, NavSection[]> = {
  '/command-center': [{ items: [{ id:'overview',label:'Overview' },{ id:'queues',label:'Action Queues' },{ id:'activity',label:'Activity' },{ id:'insights',label:'AI Insights' }] }],
  '/lot-intake': [
    { items: [{ id:'all',label:'All LOTs' }] },
    { heading:'By Status', items: [{ id:'purchased',label:'Purchased' },{ id:'in-transit',label:'In Transit' },{ id:'arrived',label:'Arrived' },{ id:'processing',label:'Processing' },{ id:'active',label:'Active' },{ id:'partial',label:'Partial' },{ id:'closed',label:'Closed' }] },
    { heading:'Partners', items: [{ id:'vendors',label:'Vendors' },{ id:'funding',label:'Funding Partners' }] },
  ],
  '/inventory': [
    { items: [{ id:'all',label:'All Items' }] },
    { heading:'Queues', items: [{ id:'unprocessed',label:'Intake Queue' },{ id:'testing',label:'Testing' },{ id:'photography',label:'Photography' },{ id:'listing',label:'Listing Queue' }] },
    { heading:'Fulfillment', items: [{ id:'active',label:'Active' },{ id:'picked',label:'Picked' },{ id:'packed',label:'Packed' },{ id:'shipped',label:'Shipped' },{ id:'delivered',label:'Delivered' }] },
    { heading:'Exceptions', items: [{ id:'returned',label:'Returned' },{ id:'scrapped',label:'Scrapped' }] },
  ],
  '/warehouse': [{ items: [{ id:'overview',label:'Overview' },{ id:'locations',label:'All Locations' },{ id:'movements',label:'Movement Log' }] }],
  '/marketplace': [
    { items: [{ id:'all',label:'All Listings' }] },
    { heading:'Status', items: [{ id:'active',label:'Active' },{ id:'pending',label:'Pending Sync' },{ id:'sold',label:'Sold' },{ id:'error',label:'Errors' }] },
    { heading:'Channels', items: [{ id:'ebay',label:'eBay' },{ id:'shopify',label:'Shopify' }] },
  ],
  '/orders': [
    { items: [{ id:'all',label:'All Orders' }] },
    { heading:'Fulfillment', items: [{ id:'open',label:'Open' },{ id:'picking',label:'Picking' },{ id:'packed',label:'Packed' },{ id:'shipped',label:'Shipped' },{ id:'delivered',label:'Delivered' }] },
    { heading:'Exceptions', items: [{ id:'returned',label:'Returned' },{ id:'cancelled',label:'Cancelled' }] },
  ],
  '/shipping': [
    { items: [{ id:'all',label:'All Shipments' }] },
    { heading:'Queue', items: [{ id:'label-created',label:'Label Queue' },{ id:'packed',label:'Packed' },{ id:'in-transit',label:'In Transit' },{ id:'delivered',label:'Delivered' },{ id:'exceptions',label:'Exceptions' }] },
  ],
  '/returns': [
    { items: [{ id:'all',label:'All Returns' }] },
    { heading:'Queue', items: [{ id:'inspection',label:'Inspection Queue' },{ id:'restocked',label:'Restocked' },{ id:'relisted',label:'Relisted' },{ id:'scrapped',label:'Scrapped' }] },
  ],
  '/partners': [
    { items: [{ id:'overview',label:'Overview' }] },
    { heading:'Relationships', items: [{ id:'vendors',label:'Vendors' },{ id:'funding',label:'Funding Partners' },{ id:'recovery',label:'Recovery Tracker' }] },
  ],
  '/reports': [
    { items: [{ id:'overview',label:'Overview' }] },
    { heading:'Analytics', items: [{ id:'recovery',label:'Recovery Analytics' },{ id:'margins',label:'Margin Analytics' },{ id:'aging',label:'Inventory Aging' },{ id:'vendor',label:'Vendor Performance' },{ id:'marketplace',label:'Marketplace' }] },
    { heading:'Saved', items: [{ id:'saved',label:'Saved Reports' }] },
  ],
  '/integrations': [
    { items: [{ id:'all',label:'All Integrations' }] },
    { heading:'Category', items: [{ id:'marketplace',label:'Marketplace' },{ id:'shipping',label:'Shipping' },{ id:'accounting',label:'Accounting' }] },
  ],
  '/ai-ops': [{ items: [{ id:'overview',label:'Overview' },{ id:'listing-gen',label:'Listing Generator' },{ id:'manifest',label:'Manifest Parser' },{ id:'insights',label:'Recovery Insights' },{ id:'suggestions',label:'Workflow Suggestions' }] }],
  '/components': [
    { items: [{ id:'overview',label:'Overview' }] },
    { heading:'Inventory', items: [{ id:'component-inventory',label:'Component Inventory' },{ id:'low-stock',label:'Low Stock' }] },
    { heading:'Activity', items: [{ id:'transactions',label:'Transactions' }] },
    { heading:'Setup', items: [{ id:'bundles',label:'Bundles' },{ id:'categories',label:'Categories' }] },
  ],
  '/supplies': [
    { items: [{ id:'overview',label:'Overview' }] },
    { heading:'Inventory', items: [{ id:'supply-inventory',label:'Supply Inventory' },{ id:'low-stock',label:'Low Stock' },{ id:'reorder',label:'Reorder' }] },
    { heading:'Activity', items: [{ id:'transactions',label:'Transactions' },{ id:'usage',label:'Usage Log' }] },
    { heading:'Setup', items: [{ id:'templates',label:'Pkg Templates' },{ id:'invoice-imports',label:'Invoice Imports' },{ id:'categories',label:'Categories' }] },
  ],
  '/settings': [
    { items: [{ id:'org',label:'Organization' },{ id:'account',label:'Account' }] },
    { heading:'Access', items: [{ id:'users',label:'Users & Roles' },{ id:'permissions',label:'Permissions' },{ id:'api',label:'API Keys' }] },
    { heading:'Preferences', items: [{ id:'notifications',label:'Notifications' },{ id:'branding',label:'Branding' },{ id:'inventory',label:'Inventory IDs' },{ id:'warehouse',label:'Warehouse' }] },
  ],
};

// Mobile secondary nav dropdown — reads current route and renders a compact pill selector
function MobileSecondaryNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { view: viewParam } = useParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const basePath = '/' + location.pathname.split('/').filter(Boolean)[0];
  const sections = secondaryNavConfig[basePath];
  if (!sections) return null;

  const allItems = sections.flatMap(s => s.items);
  const activeId = viewParam ?? allItems[0]?.id;
  const activeLabel = allItems.find(i => i.id === activeId)?.label ?? activeId;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div
      ref={ref}
      className="relative"
      style={{ position: 'relative' }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[rgba(0,0,0,0.1)] text-[13px] font-medium text-gray-700 shadow-sm"
      >
        {activeLabel}
        <ChevronDown size={13} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-[rgba(0,0,0,0.09)] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] z-50 min-w-[180px] py-1 overflow-hidden max-h-[70vh] overflow-y-auto">
          {sections.map((section, si) => (
            <div key={si}>
              {section.heading && (
                <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-[0.06em]">
                  {section.heading}
                </p>
              )}
              {section.items.map(item => {
                const isActive = activeId === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { navigate(`${basePath}/${item.id}`); setOpen(false); }}
                    className={`w-full px-3 py-2 text-left text-[13px] transition-colors ${
                      isActive
                        ? 'bg-[#F0FDF4] text-[#15803d] font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, loading, orgId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  // Close mobile nav on route change
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  if (loading) return <FullPageLoader />;
  if (!user) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      <TopBar />

      {/* Mobile sub-bar: hamburger + secondary nav dropdown */}
      <div
        className="deryv-mobile-subbar flex items-center gap-3 px-3 py-2 bg-white border-b border-[rgba(0,0,0,0.08)] flex-shrink-0"
        style={{ display: 'none' }}
      >
        <button
          onClick={() => setMobileNavOpen(o => !o)}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 transition-colors flex-shrink-0"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>
        <MobileSecondaryNav />
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Desktop sidebars — hidden on mobile via CSS */}
        <div className="deryv-desktop-sidebars flex min-h-0">
          <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(c => !c)} />
          <SecondarySidebar />
        </div>

        {/* Mobile nav drawer overlay */}
        {mobileNavOpen && (
          <div
            className="deryv-mobile-drawer"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 40,
              display: 'flex',
            }}
          >
            {/* Backdrop */}
            <div
              onClick={() => setMobileNavOpen(false)}
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.3)',
                backdropFilter: 'blur(1px)',
              }}
            />
            {/* Drawer panel — render Sidebar in expanded mode */}
            <div
              style={{
                position: 'relative',
                zIndex: 1,
                width: 220,
                height: '100%',
                background: '#fff',
                boxShadow: '4px 0 24px rgba(0,0,0,0.12)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* Close button row */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 8px 0' }}>
                <button
                  onClick={() => setMobileNavOpen(false)}
                  style={{
                    width: 32, height: 32,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 6, border: 'none', background: 'none',
                    cursor: 'pointer', color: '#6B7280',
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <Sidebar collapsed={false} onToggle={() => setMobileNavOpen(false)} />
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto bg-[#F4F5F6]">
          <Outlet />
        </main>
      </div>

      {/* Responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .deryv-desktop-sidebars { display: none !important; }
          .deryv-mobile-subbar { display: flex !important; }
        }
        @media (min-width: 769px) {
          .deryv-mobile-subbar { display: none !important; }
          .deryv-desktop-sidebars { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
