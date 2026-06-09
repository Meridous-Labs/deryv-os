import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  logo_url?: string | null;
  accent_color?: string | null;
  support_email?: string | null;
  website?: string | null;
}

export interface OrgMembership {
  organization_id: string;
  role: 'admin' | 'manager' | 'warehouse' | 'accounting' | 'viewer';
  organization: Organization;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  orgMemberships: OrgMembership[];
  currentOrg: Organization | null;
  currentRole: OrgMembership['role'] | null;
  orgId: string | null;
  setCurrentOrgId: (id: string) => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshMemberships: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgMemberships, setOrgMemberships] = useState<OrgMembership[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);

  const ORG_STORAGE_KEY = 'deryv.currentOrgId';

  const loadOrgMemberships = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('organization_members')
      .select('organization_id, role, organizations(id, name, slug, plan, logo_url, accent_color, support_email, website)')
      .eq('user_id', userId);

    if (error) {
      console.error('Error loading org memberships:', error.message);
      return;
    }

    const memberships: OrgMembership[] = (data || []).map((d: any) => ({
      organization_id: d.organization_id,
      role: d.role,
      organization: Array.isArray(d.organizations) ? d.organizations[0] : d.organizations,
    })).filter(m => m.organization);

    setOrgMemberships(memberships);

    setCurrentOrgId(prev => {
      // Prefer persisted org if user still belongs to it
      const saved = localStorage.getItem(ORG_STORAGE_KEY);
      if (saved && memberships.find(m => m.organization_id === saved)) return saved;
      if (prev && memberships.find(m => m.organization_id === prev)) return prev;
      const terminalOne = memberships.find(m =>
        m.organization.name?.toUpperCase().includes('TERMINAL ONE') ||
        m.organization.slug === 'terminal-one'
      );
      return (terminalOne ?? memberships[0])?.organization_id ?? null;
    });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadOrgMemberships(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadOrgMemberships(session.user.id);
      } else {
        setOrgMemberships([]);
        setCurrentOrgId(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadOrgMemberships]);

  const currentMembership = orgMemberships.find(m => m.organization_id === currentOrgId);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const handleSetCurrentOrgId = useCallback((id: string) => {
    localStorage.setItem('deryv.currentOrgId', id);
    setCurrentOrgId(id);
  }, []);

  const signOut = async () => {
    localStorage.removeItem('deryv.currentOrgId');
    localStorage.removeItem('deryv.lastRoute');
    await supabase.auth.signOut();
  };

  const refreshMemberships = async () => {
    if (user) await loadOrgMemberships(user.id);
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      orgMemberships,
      currentOrg: currentMembership?.organization ?? null,
      currentRole: currentMembership?.role ?? null,
      orgId: currentOrgId,
      setCurrentOrgId: handleSetCurrentOrgId,
      signIn,
      signOut,
      refreshMemberships,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
