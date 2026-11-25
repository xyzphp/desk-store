import { useEffect, useState } from 'react';

export type DataState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

/** 读取一次静态数据；key 变化时重新读取，迟到的旧结果被丢弃。 */
export function useData<T>(load: () => Promise<T>, key: string): DataState<T> {
  const [state, setState] = useState<DataState<T>>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    load().then(
      (data) => active && setState({ status: 'ready', data }),
      (error: unknown) => active && setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      active = false;
    };
    // load 由调用方按 key 决定，避免每次渲染重新请求。
  }, [key]);
  return state;
}
