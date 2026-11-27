import { useEffect, useRef } from 'react';
import { useSession } from '../../host/HostProvider';

export function useSessionGuard(onClear: () => void) {
  const session = useSession();
  const prevGen = useRef(session.generation);
  const clearRef = useRef(onClear);
  clearRef.current = onClear;

  useEffect(() => {
    if (session.status !== 'ready' || prevGen.current !== session.generation) {
      prevGen.current = session.generation;
      if (session.status !== 'ready') clearRef.current();
    }
  }, [session.generation, session.status]);
}
