import type { HostSession } from '../../host/types';

export interface PermissionOptions {
  admin?: boolean;
}

export function canUse(session: HostSession, permission?: string, options?: PermissionOptions): boolean {
  if (session.status !== 'ready' || !session.user) return false;
  if (options?.admin && !session.user.isAdmin) return false;
  if (!permission || permission === 'article-management') return true;
  if (permission === 'site.settings') return session.user.permissions.includes('site.settings');
  return session.user.permissions.includes(permission) || session.user.apps.includes(permission);
}
