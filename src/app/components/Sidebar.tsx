import { useState } from 'react';
import { NavLink } from 'react-router';
const DERYV_LOGO = 'https://byzjsafupehesiwbqkxt.supabase.co/storage/v1/object/public/brand-assets/deryv-logo.png';
import {
  LayoutDashboard, Package, Archive, Building2, Store, ClipboardList,
  Truck, RotateCcw, Users, BarChart2, Plug, Sparkles, Settings,
  PanelLeftClose, PanelLeftOpen, ChevronsUpDown, Check, LogOut, Boxes, Cpu
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const navItems = [
  { label: 'Command Center', path: '/command-center', icon: LayoutDashboard },
  { label: 'LOT Intake', path: '/lot-intake', icon: Package },
  { label: 'Inventory', path: '/inventory', icon: Archive },
  { label: 'Warehouse', path: '/warehouse', icon: Building2 },
  { label: 'Supplies', path: '/supplies', icon: Boxes },
  { label: 'Components', path: '/components', icon: Cpu },
  { label: 'Marketplace', path: '/marketplace', icon: Store },
  { label: 'Orders', path: '/orders', icon: ClipboardList },
  { label: 'Shipping', path: '/shipping', icon: Truck },
  { label: 'Returns', path: '/returns', icon: RotateCcw },
  { label: 'Partners', path: '/partners', icon: Users },
  { label: 'Reports', path: '/reports', icon: BarChart2 },
  { label: 'Integrations', path: '/integrations', icon: Plug },
  { label: 'AI Ops', path: '/ai-ops', icon: Sparkles },
  { label: 'Settings', path: '/settings', icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { orgMemberships, currentOrg, orgId, setCurrentOrgId, signOut } = useAuth();
  const [orgOpen, setOrgOpen] = useState(false);

  return (
    <aside
      className={`flex flex-col h-full bg-white border-r border-[rgba(0,0,0,0.08)] transition-all duration-200 flex-shrink-0 ${
        collapsed ? 'w-[52px]' : 'w-[200px]'
      }`}
    >
      {/* Org Switcher */}
      <div className={`py-2.5 border-b border-[rgba(0,0,0,0.06)] relative flex-shrink-0 ${collapsed ? 'px-2' : 'px-2.5'}`}>
        {!collapsed ? (
          <>
            <button
              onClick={() => setOrgOpen(!orgOpen)}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-gray-50 text-left transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded bg-gray-900 flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-semibold text-[10px]">{currentOrg?.name?.[0] ?? '?'}</span>
                </div>
                <p className="text-[13px] font-medium text-gray-900 truncate">{currentOrg?.name ?? 'No organization'}</p>
              </div>
              <ChevronsUpDown size={11} className="text-gray-400 flex-shrink-0" />
            </button>
            {orgOpen && orgMemberships.length > 0 && (
              <div className="absolute left-2.5 right-2.5 top-full mt-1 bg-white border border-[rgba(0,0,0,0.1)] rounded-lg shadow-xl z-50 overflow-hidden py-1">
                {orgMemberships.map(m => (
                  <button
                    key={m.organization_id}
                    onClick={() => { setCurrentOrgId(m.organization_id); setOrgOpen(false); }}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 text-left"
                  >
                    <div>
                      <p className="text-[13px] font-medium text-gray-900">{m.organization.name}</p>
                      <p className="text-[11px] text-gray-400 capitalize">{m.role} · {m.organization.plan}</p>
                    </div>
                    {m.organization_id === orgId && <Check size={12} className="text-[#3ECF8E]" />}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex justify-center">
            <div className="w-7 h-7 rounded bg-gray-900 flex items-center justify-center">
              <span className="text-white font-semibold text-[10px]">{currentOrg?.name?.[0] ?? '?'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-1.5">
        {navItems.map(item => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2 py-[7px] rounded-md mb-px transition-colors text-[13px] ${
                  isActive
                    ? 'bg-[#F0FDF4] text-[#15803d] font-medium'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                } ${collapsed ? 'justify-center' : ''}`
              }
              title={collapsed ? item.label : undefined}
            >
              {({ isActive }) => (
                <>
                  <Icon size={15} className={`flex-shrink-0 ${isActive ? 'text-[#3ECF8E]' : 'text-gray-400'}`} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div className="border-t border-[rgba(0,0,0,0.06)] p-1.5 flex-shrink-0 space-y-px">
        <button
          onClick={() => signOut()}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors ${collapsed ? 'justify-center' : ''}`}
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut size={14} />
          {!collapsed && <span className="text-[12px]">Sign out</span>}
        </button>
        <button
          onClick={onToggle}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors ${collapsed ? 'justify-center' : ''}`}
        >
          {collapsed
            ? <PanelLeftOpen size={14} />
            : <><PanelLeftClose size={14} /><span className="text-[12px]">Collapse</span></>
          }
        </button>
      </div>

      {/* deryv logo — overflow-hidden crops whitespace padding baked into the image */}
      <div className={`border-t border-[rgba(0,0,0,0.06)] flex items-center justify-center flex-shrink-0 ${collapsed ? 'py-1' : 'py-2'}`}>
        <img
          src={DERYV_LOGO}
          alt="deryv"
          className={`object-contain ${collapsed ? 'h-[21px] w-auto' : 'h-[26px] w-auto'}`}
        />
      </div>
    </aside>
  );
}

