import { useCallback, useEffect, useRef } from 'react';
import { useSession } from '../../host/HostProvider';
import { platformWorkspaceGet, platformWorkspaceSave } from '../sdk/bridge';

export interface WorkspaceStateOptions {
  capture: () => unknown;
  restore: (raw: unknown) => Promise<void> | void;
  blocked?: () => boolean;
  beforeClose?: () => Promise<boolean> | boolean;
}

export function useWorkspaceState(_key: string, options: WorkspaceStateOptions) {
  const session = useSession();
  const latest = useRef(options);
  latest.current = options;
  const restoredForGen = useRef<number>(-1);
  const timer = useRef<number | undefined>(undefined);

  // 仅在会话就绪且该会话代次尚未恢复时执行一次恢复，避免后续状态变更误触发覆盖草稿
  useEffect(() => {
    if (session.status !== 'ready') return;
    if (restoredForGen.current === session.generation) return;
    restoredForGen.current = session.generation;
    let cancelled = false;
    void platformWorkspaceGet()
      .then((raw) => {
        if (cancelled || raw === null || raw === undefined) return;
        return latest.current.restore(raw);
      })
      .catch(() => {
        /* 恢复失败不阻塞正常打开工作台 */
      });
    return () => {
      cancelled = true;
    };
  }, [session.generation, session.status]);

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      if (latest.current.blocked?.()) return;
      const snapshot = latest.current.capture();
      if (snapshot === null || snapshot === undefined) return;
      void platformWorkspaceSave(snapshot).catch(() => undefined);
    }, 600);
  }, []);
}
