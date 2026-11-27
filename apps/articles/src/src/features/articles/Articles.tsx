import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useMessages } from '@xyzos/desk-ui';
import { ArticleEditor } from './ArticleEditor';
import { ArticleLibrary } from './ArticleLibrary';
import { ArticleSidebar } from './ArticleSidebar';
import { ArticleSiteSettings } from './ArticleSiteSettings';
import { useArticles } from './useArticles';
import { articleMessages } from './locale';
import './articles.css';
import './markdown-editor.css';

interface ActiveResize {
  side: 'sidebar' | 'library';
  pointerId: number;
  startX: number;
  startWidth: number;
}

export default function Articles() {
  const state = useArticles();
  const t = useMessages(articleMessages);
  const [activeResize, setActiveResize] = useState<ActiveResize | null>(null);

  const startResize = (side: ActiveResize['side'], event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActiveResize({
      side,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: side === 'sidebar' ? state.sidebarWidth : state.libraryWidth,
    });
    event.currentTarget.classList.add('is-dragging');
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    const active = activeResize;
    if (!active || active.pointerId !== event.pointerId) return;
    const width = event.currentTarget.parentElement?.clientWidth ?? window.innerWidth;
    if (active.side === 'sidebar') {
      const otherWidth = state.libraryCollapsed ? 0 : state.libraryWidth;
      state.setSidebarWidth(
        Math.max(150, Math.min(420, width - otherWidth - 840, active.startWidth + event.clientX - active.startX)),
      );
    } else {
      state.setLibraryWidth(
        Math.max(
          200,
          Math.min(520, width - state.sidebarWidth - 840, active.startWidth + event.clientX - active.startX),
        ),
      );
    }
  };
  const stopResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!activeResize || activeResize.pointerId !== event.pointerId) return;
    setActiveResize(null);
    event.currentTarget.classList.remove('is-dragging');
  };
  const resizeProps = (side: ActiveResize['side']) => ({
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    tabIndex: 0,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => startResize(side, event),
    onPointerMove: moveResize,
    onPointerUp: stopResize,
    onPointerCancel: stopResize,
    onDoubleClick: () => (side === 'sidebar' ? state.setSidebarWidth(224) : state.setLibraryWidth(292)),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const delta = event.shiftKey ? 40 : 12;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const sign = event.key === 'ArrowRight' ? 1 : -1;
      if (side === 'sidebar') state.setSidebarWidth((value) => Math.max(150, Math.min(420, value + sign * delta)));
      else state.setLibraryWidth((value) => Math.max(200, Math.min(520, value + sign * delta)));
    },
  });

  return (
    <div
      className={`ar-app${state.libraryCollapsed ? ' is-library-collapsed is-focus-mode' : ''}${state.siteOpen ? ' is-site' : ''}`}
    >
      <ArticleSidebar state={state} />
      <div
        className="ar-sidebar-resizer"
        data-ar-sidebar-resizer
        aria-label={t.app.sidebarResizeAria}
        aria-valuemin={150}
        aria-valuemax={420}
        aria-valuenow={state.sidebarWidth}
        title={t.app.sidebarResizeTitle}
        {...resizeProps('sidebar')}
      />
      <ArticleLibrary state={state} />
      <div
        className="ar-library-resizer"
        data-ar-library-resizer
        aria-label={t.app.libraryResizeAria}
        aria-valuemin={200}
        aria-valuemax={520}
        aria-valuenow={state.libraryWidth}
        title={t.app.libraryResizeTitle}
        hidden={state.libraryCollapsed || state.siteOpen}
        {...resizeProps('library')}
      />
      <main className="ar-main">
        <div
          className={`ar-status${state.error ? ' is-error' : ''}`}
          data-ar-status
          role={state.error ? 'alert' : 'status'}
          aria-live="polite"
        >
          {state.error || state.status}
        </div>
        <div className="ar-editor-host" data-ar-editor>
          {state.siteOpen ? <ArticleSiteSettings state={state} /> : <ArticleEditor state={state} />}
        </div>
      </main>
    </div>
  );
}
