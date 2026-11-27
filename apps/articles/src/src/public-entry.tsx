import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, type ThemeChoice } from '@xyzos/desk-ui';
import PublicArticleSite from './features/articles/PublicArticleSite';
import { PublicArticleAppearanceContext } from './features/articles/publicArticleAppearance';

interface PublicContextPayload {
  slug?: string;
  baseUrl?: string;
  backendBase?: string;
  signedIn?: boolean;
  user?: { id: number; displayName: string };
}

function readPublicContext(): Required<Pick<PublicContextPayload, 'baseUrl' | 'backendBase'>> {
  let payload: PublicContextPayload = {};
  try {
    const node = document.getElementById('xyzos-public-context');
    if (node?.textContent) {
      payload = JSON.parse(node.textContent) as PublicContextPayload;
    }
  } catch {
    /* ignore malformed context */
  }
  const baseUrl = (payload.baseUrl || '/articles').replace(/\/+$/, '');
  const backendBase = (payload.backendBase || `${baseUrl}/_backend`).replace(/\/+$/, '');
  return { baseUrl, backendBase };
}

function readStoredTheme(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem('articles-public-theme');
    if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw;
  } catch {
    /* 沙箱不透明源禁止 localStorage 时退化为内存态 */
  }
  return 'auto';
}

function PublicApp() {
  const ctx = useMemo(readPublicContext, []);
  const [theme, setThemeState] = useState<ThemeChoice>(readStoredTheme);

  const setTheme = (next: ThemeChoice) => {
    setThemeState(next);
    try {
      window.localStorage.setItem('articles-public-theme', next);
    } catch {
      /* ignore sandbox storage restriction */
    }
  };

  let initialPath = ctx.baseUrl;
  try {
    const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (path && path !== 'blank' && !path.startsWith('srcdoc')) {
      initialPath = path;
    }
  } catch {
    initialPath = ctx.baseUrl;
  }

  return (
    <ConfigProvider locale={document.documentElement.lang || 'zh-CN'}>
      <PublicArticleAppearanceContext.Provider value={{ theme, setTheme }}>
        <PublicArticleSite
          base={ctx.baseUrl}
          backendBase={ctx.backendBase}
          initialPath={initialPath}
          frameWindow={window}
        />
      </PublicArticleAppearanceContext.Provider>
    </ConfigProvider>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<PublicApp />);
}
