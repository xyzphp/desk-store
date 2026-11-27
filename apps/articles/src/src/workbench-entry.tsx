import { createRoot } from 'react-dom/client';
import { AppHostProvider } from './host/HostProvider';
import Articles from './features/articles/Articles';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <AppHostProvider>
      <Articles />
    </AppHostProvider>,
  );
}
