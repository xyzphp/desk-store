import { useMemo } from 'react';
import { platformAlert, platformConfirm } from '../sdk/bridge';

export interface DialogConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface DialogAlertOptions {
  title: string;
  message: string;
}

export function useDialogs(allowed: boolean) {
  return useMemo(
    () => ({
      async confirm(options: DialogConfirmOptions): Promise<boolean> {
        if (!allowed) return false;
        try {
          const res = await platformConfirm({
            title: options.title,
            message: options.message,
            okText: options.confirmLabel,
            cancelText: options.cancelLabel,
            danger: options.danger,
          });
          return Boolean(res);
        } catch {
          return window.confirm(`${options.title}\n\n${options.message}`);
        }
      },
      async alert(options: DialogAlertOptions): Promise<void> {
        if (!allowed) return;
        try {
          await platformAlert({ title: options.title, message: options.message });
        } catch {
          window.alert(`${options.title}\n\n${options.message}`);
        }
      },
    }),
    [allowed],
  );
}
