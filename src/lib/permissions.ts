export type OrgRole = 'admin' | 'manager' | 'warehouse' | 'accounting' | 'viewer';

export const canEdit = (role: OrgRole | null | undefined): boolean =>
  role === 'admin' || role === 'manager';

export const canEditOps = (role: OrgRole | null | undefined): boolean =>
  canEdit(role) || role === 'warehouse';

export const canEditFinance = (role: OrgRole | null | undefined): boolean =>
  canEdit(role) || role === 'accounting';

export const isAdmin = (role: OrgRole | null | undefined): boolean =>
  role === 'admin';
