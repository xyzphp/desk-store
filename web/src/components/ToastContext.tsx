import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastContextValue {
  notify: (message: string) => void;
  copyText: (text: string, successMessage?: string) => Promise<void>;
}

const ToastContext = createContext<ToastContextValue>({
  notify: () => {},
  copyText: async () => {},
});

/** 复制文本到剪贴板，优先使用 Clipboard API，回退到只读 textarea 选中复制。 */
async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 非安全上下文或权限受限时走降级路径。
    }
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export function StoreToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const timerRef = useRef<number | undefined>(undefined);

  const notify = useCallback((next: string) => {
    setMessage(next);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setMessage(''), 2400);
  }, []);

  const copyText = useCallback(
    async (text: string, successMessage = '已复制') => {
      const ok = await writeClipboard(text);
      notify(ok ? successMessage : '复制失败，请手动选中复制');
      if (!ok) throw new Error('clipboard copy failed');
    },
    [notify],
  );

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return (
    <ToastContext.Provider value={{ notify, copyText }}>
      {children}
      <div className="store-toast" role="status" aria-live="polite" hidden={!message}>
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export function useStoreToast() {
  return useContext(ToastContext);
}
