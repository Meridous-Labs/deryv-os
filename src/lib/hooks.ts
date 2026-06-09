import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabase';

export function pkOf(_table: string): string {
  return 'id';
}

export interface QueryState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// ─── useOrgQuery ──────────────────────────────────────────────────────────────
//
// filterKey: pass a stable primitive (e.g. the status string or 'all') whenever
// the filter function changes. useCallback tracks filterKey, not the filter
// function itself (which changes identity every render), so there is no
// infinite-reload loop while filter changes still trigger a reload.

export function useOrgQuery<T = any>(
  table: string,
  orgId: string | null,
  options?: {
    select?: string;
    filter?: (q: any) => any;
    filterKey?: string | null;
    orderBy?: string;
    ascending?: boolean;
    enabled?: boolean;
  }
): QueryState<T> {
  const {
    select = '*',
    filter,
    filterKey,
    orderBy = 'created_at',
    ascending = false,
    enabled = true,
  } = options || {};

  // Hold the latest filter without causing re-renders or stale closures
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let q = supabase
      .from(table)
      .select(select)
      .eq('organization_id', orgId)
      .order(orderBy, { ascending });
    if (filterRef.current) q = filterRef.current(q);
    const { data: rows, error: err } = await q;
    if (err) {
      console.error(`[useOrgQuery] ${table}:`, err.message);
      setError(err.message);
    } else setData((rows ?? []) as T[]);
    setLoading(false);
  // filterKey (not filter function) drives reload when the query predicate changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, table, select, orderBy, ascending, enabled, filterKey]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}

export function useOrgCount(
  table: string,
  orgId: string | null,
  filter?: (q: any) => any
): { count: number; loading: boolean } {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    let q = supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId);
    if (filter) q = filter(q);
    q.then(({ count: c }) => {
      setCount(c ?? 0);
      setLoading(false);
    });
  }, [orgId, table]);

  return { count, loading };
}

export async function insertRow<T = any>(
  table: string,
  data: T & { organization_id: string }
): Promise<{ error: string | null; data: any }> {
  const { data: row, error } = await supabase.from(table).insert(data).select().single();
  if (error) console.error(`[insertRow] ${table}:`, error.message);
  return { error: error?.message ?? null, data: row };
}

export async function updateRow<T = any>(
  table: string,
  id: string,
  data: Partial<T>
): Promise<{ error: string | null }> {
  const pk = pkOf(table);
  const { error } = await supabase.from(table).update(data).eq(pk, id);
  if (error) console.error(`[updateRow] ${table}:`, error.message);
  return { error: error?.message ?? null };
}

export async function deleteRow(table: string, id: string): Promise<{ error: string | null }> {
  const pk = pkOf(table);
  const { error } = await supabase.from(table).delete().eq(pk, id);
  if (error) console.error(`[deleteRow] ${table}:`, error.message);
  return { error: error?.message ?? null };
}

export async function countLinked(
  table: string,
  foreignKey: string,
  id: string
): Promise<number> {
  const { count } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(foreignKey, id);
  return count ?? 0;
}

// ─── logActivity ──────────────────────────────────────────────────────────────
//
// eventType: optional 6th argument, defaults to 'activity'.
// All existing callers that omit it continue to work unchanged.

export async function logActivity(
  orgId: string,
  userId: string,
  message: string,
  entityType?: string,
  entityId?: string,
  eventType: string = 'activity'
) {
  const { error } = await supabase.from('activity_log').insert({
    organization_id: orgId,
    actor_id:        userId || null,
    event_type:      eventType,
    entity_type:     entityType ?? null,
    entity_id:       entityId  ?? null,
    message,
  });
  if (error) console.error('[logActivity]:', error.message);
}

// ─── createNotification ───────────────────────────────────────────────────────
//
// Optional helper for inserting a notification row. Use sparingly — only for
// high-value events: manifest confirmed, shipment exception, low stock,
// import errors, return created.

export async function createNotification(
  orgId: string,
  title: string,
  message: string,
  options?: {
    userId?: string;
    entityType?: string;
    entityId?: string | null;
    route?: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
  }
) {
  const { error } = await supabase.from('notifications').insert({
    organization_id: orgId,
    user_id:         options?.userId  ?? null,
    title,
    message,
    priority:        options?.priority    ?? 'low',
    entity_type:     options?.entityType  ?? null,
    entity_id:       options?.entityId    ?? null,
    route:           options?.route       ?? null,
    is_read:         false,
  });
  if (error) console.error('[createNotification]:', error.message);
}
