import { type ReactNode, useEffect, useState } from 'react';
import { Icon, Workspace } from '@xyzos/desk-ui';
import { href, type Route } from '../router';
import { BrandLogo } from './BrandLogo';
import { StoreToastProvider } from './ToastContext';

type Theme = 'light' | 'dark';

const themeKey = 'desk-store-theme';

function initialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(themeKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // 无法读取本地存储时跟随系统。
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const links: { label: string; route: Route; match: Route['name'][] }[] = [
  { label: '首页', route: { name: 'home' }, match: ['home'] },
  { label: '应用', route: { name: 'apps' }, match: ['apps', 'app'] },
  { label: '文档', route: { name: 'docs', section: 'site', page: 'overview' }, match: ['docs'] },
];

export function Layout({ route, children }: { route: Route; children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      window.localStorage.setItem(themeKey, next);
    } catch {
      // 偏好只是便利功能，保存失败不影响使用。
    }
  };

  return (
    <StoreToastProvider>
      <Workspace className="store-page">
        <header className="store-header">
          <div className="store-header-inner">
            <a className="store-brand" href={href({ name: 'home' })} aria-label="Desk Store · 开源应用商店">
              <span className="store-brand-mark">
                <BrandLogo size={36} />
              </span>
              <span className="store-brand-word">
                <strong>Desk Store</strong>
                <small>开源应用商店</small>
              </span>
            </a>
            <nav className="store-nav" aria-label="主导航">
              {links.map((link) => (
                <a
                  key={link.label}
                  href={href(link.route)}
                  aria-current={link.match.includes(route.name) ? 'page' : undefined}
                >
                  {link.label}
                </a>
              ))}
              <a href="https://github.com/xyzphp/desk-store" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </nav>
            <div className="store-header-actions">
              <button
                type="button"
                className="store-theme-btn"
                aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
                aria-pressed={theme === 'dark'}
                onClick={toggle}
              >
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
                <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
              </button>
            </div>
          </div>
        </header>
        <main className="store-main">{children}</main>
        <footer className="store-footer">
          <div className="store-footer-inner">
            <span>Desk Store · MIT License</span>
            <span>应用以源码提交，由 CI 确定性打包并签名发布。</span>
          </div>
        </footer>
      </Workspace>
    </StoreToastProvider>
  );
}
