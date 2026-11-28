import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppHostProvider } from './host/HostProvider';
import Articles from './features/articles/Articles';

interface BoundaryState {
  error: Error | null;
}

class ArticleErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[articles] render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: 'var(--bg-panel, #fff)',
          color: 'var(--text, #111)',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360, alignItems: 'center' }}>
          <strong style={{ fontSize: 15 }}>应用页面渲染异常</strong>
          <span style={{ fontSize: 13, color: 'var(--text-2, #666)' }}>
            {this.state.error.message || '请点击重新加载恢复工作台。'}
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 8,
              border: '1px solid var(--border, #d4d4d8)',
              background: 'var(--accent, #2563eb)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <ArticleErrorBoundary>
      <AppHostProvider>
        <Articles />
      </AppHostProvider>
    </ArticleErrorBoundary>,
  );
}
