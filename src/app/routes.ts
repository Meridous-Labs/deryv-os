import { createBrowserRouter, redirect } from 'react-router';
import { Layout } from './components/Layout';
import { RouteErrorPage } from './components/RouteErrorPage';
import { Login } from './pages/Login';
import { CommandCenter } from './pages/CommandCenter';
import { LotIntake } from './pages/LotIntake';
import { Inventory } from './pages/Inventory';
import { Warehouse } from './pages/Warehouse';
import { Supplies } from './pages/Supplies';
import { Components } from './pages/Components';
import { Marketplace } from './pages/Marketplace';
import { Orders } from './pages/Orders';
import { Shipping } from './pages/Shipping';
import { Returns } from './pages/Returns';
import { Partners } from './pages/Partners';
import { Reports } from './pages/Reports';
import { Integrations } from './pages/Integrations';
import { AiOps } from './pages/AiOps';
import { Settings } from './pages/Settings';

export const router = createBrowserRouter([
  {
    path: '/login',
    Component: Login,
    ErrorBoundary: RouteErrorPage,
  },
  {
    path: '/',
    Component: Layout,
    ErrorBoundary: RouteErrorPage,
    children: [
      { index: true, loader: () => redirect('/command-center') },
      { path: 'command-center', children: [
        { index: true, loader: () => redirect('/command-center/overview') },
        { path: ':view', Component: CommandCenter },
      ]},
      { path: 'lot-intake', children: [
        { index: true, loader: () => redirect('/lot-intake/all') },
        { path: ':view', Component: LotIntake },
      ]},
      { path: 'inventory', children: [
        { index: true, loader: () => redirect('/inventory/all') },
        { path: ':view', Component: Inventory },
      ]},
      { path: 'warehouse', children: [
        { index: true, loader: () => redirect('/warehouse/overview') },
        { path: ':view', Component: Warehouse },
      ]},
      { path: 'supplies', children: [
        { index: true, loader: () => redirect('/supplies/overview') },
        { path: ':view', Component: Supplies },
      ]},
      { path: 'components', children: [
        { index: true, loader: () => redirect('/components/overview') },
        { path: ':view', Component: Components },
      ]},
      { path: 'marketplace', children: [
        { index: true, loader: () => redirect('/marketplace/all') },
        { path: ':view', Component: Marketplace },
      ]},
      { path: 'orders', children: [
        { index: true, loader: () => redirect('/orders/all') },
        { path: ':view', Component: Orders },
      ]},
      { path: 'shipping', children: [
        { index: true, loader: () => redirect('/shipping/all') },
        { path: ':view', Component: Shipping },
      ]},
      { path: 'returns', children: [
        { index: true, loader: () => redirect('/returns/all') },
        { path: ':view', Component: Returns },
      ]},
      { path: 'partners', children: [
        { index: true, loader: () => redirect('/partners/overview') },
        { path: ':view', Component: Partners },
      ]},
      { path: 'reports', children: [
        { index: true, loader: () => redirect('/reports/overview') },
        { path: ':view', Component: Reports },
      ]},
      { path: 'integrations', children: [
        { index: true, loader: () => redirect('/integrations/all') },
        { path: ':view', Component: Integrations },
      ]},
      { path: 'ai-ops', children: [
        { index: true, loader: () => redirect('/ai-ops/overview') },
        { path: ':view', Component: AiOps },
      ]},
      { path: 'settings', children: [
        { index: true, loader: () => redirect('/settings/org') },
        { path: ':view', Component: Settings },
      ]},
    ],
  },
]);
