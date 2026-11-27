import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useMessages } from '@xyzos/desk-ui';
import { PublicArticleDetail } from './PublicArticleDetail';
import { PublicArticleListView } from './PublicArticleList';
import {
  publicArticleLocation,
  publicArticleURL,
  publicArticleView,
  restorePublicArticleDetail,
  restorePublicArticleList,
  safeBaseOrigin,
  type PublicArticleDetail as ArticleDetail,
  type PublicArticleList as ArticleList,
  type PublicArticleView,
} from './publicArticleReader';
import PublicArticleFooter from './PublicArticleFooter';
import { PublicArticleHero } from './PublicArticleHero';
import { PublicArticleBarrageDialog, PublicArticleImageDialog } from './PublicArticleDialogs';
import { readerIcon } from './publicArticleIcons';
import { followPublicArticleRoute, writePublicArticleHistory } from './publicArticleLinks';
import {
  cleanPublicText as cleanText,
  defaultPublicArticleSite as defaultSite,
  isPublicRecord as isRecord,
  readPublicArticleSite as readSiteConfig,
  safePublicImageID as safeID,
  type PublicArticleSiteConfig as SiteConfig,
} from './publicArticleConfig';
import { articleMessages } from './locale';
import { usePublicArticleAppearance } from './publicArticleAppearance';

interface ReaderLocation {
  id: number;
  query: URLSearchParams;
  hash: string;
}

function readerView(route: ReaderLocation): PublicArticleView {
  return publicArticleView(route.query.get('view'));
}

async function fetchPublicJSON(url: string, signal: AbortSignal, fallbackError: string): Promise<unknown> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const serverErr =
      parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : '';
    throw new Error(serverErr || fallbackError);
  }
  return parsed;
}

export default function PublicArticleSite({
  base,
  backendBase,
  initialPath,
  frameWindow,
}: {
  base: string;
  backendBase: string;
  initialPath: string;
  frameWindow: Window;
}) {
  const t = useMessages(articleMessages);
  const appearance = usePublicArticleAppearance();
  const origin = safeBaseOrigin();
  const [route, setRoute] = useState<ReaderLocation>(() => {
    try {
      return publicArticleLocation(initialPath, base, origin);
    } catch {
      return { id: 0, query: new URLSearchParams(), hash: '' };
    }
  });
  const [site, setSite] = useState<SiteConfig>(() => defaultSite());
  const [quote, setQuote] = useState(() => defaultSite().description);
  const [list, setList] = useState<ArticleList | null>(null);
  const [detail, setDetail] = useState<ArticleDetail | null>(null);
  const [loadedFor, setLoadedFor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searchDraft, setSearchDraft] = useState(route.query.get('q') ?? '');
  const [zoom, setZoom] = useState<{ src: string; alt: string }>();
  const [barrageOpen, setBarrageOpen] = useState(false);
  const [quotes, setQuotes] = useState<string[]>([]);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [backTop, setBackTop] = useState(false);
  const barrageTriggerRef = useRef<HTMLButtonElement>(null);
  const backTopRef = useRef<HTMLButtonElement>(null);
  const routeNavigationRef = useRef<{ scroll: boolean; focus?: string } | null>(null);
  const currentView = readerView(route);
  const routeKey = `${route.id}:${route.query.toString()}:${route.hash}`;
  const isCurrentData = loadedFor === routeKey;
  const activeList = isCurrentData ? list : null;
  const activeDetail = isCurrentData ? detail : null;
  const loading = busy || (!error && !isCurrentData);

  const navigate = useCallback(
    (path: string, replace = false, options: { scroll?: boolean; focus?: string } = {}) => {
      let next: ReaderLocation;
      let href: string;
      try {
        const target = new URL(path, `${origin}${base.endsWith('/') ? base : `${base}/`}`);
        next = publicArticleLocation(target.href, base, origin);
        href = `${target.pathname}${target.search}${target.hash}`;
      } catch {
        setError(t.public.invalidURL);
        return;
      }
      routeNavigationRef.current = { scroll: options.scroll !== false, focus: options.focus };
      // 沙箱不透明源可能拒绝 pushState；writePublicArticleHistory 吞掉 SecurityError 并保持组件内路由切换。
      writePublicArticleHistory(frameWindow, href, replace);
      setRoute(next);
      setSearchDraft(next.query.get('q') ?? '');
    },
    [base, frameWindow, origin, t.public.invalidURL],
  );

  useEffect(() => {
    const pop = () => {
      try {
        const next = publicArticleLocation(
          `${frameWindow.location.pathname}${frameWindow.location.search}${frameWindow.location.hash}`,
          base,
          origin,
        );
        routeNavigationRef.current = { scroll: true };
        setRoute(next);
        setSearchDraft(next.query.get('q') ?? '');
      } catch {
        navigate(base, true);
      }
    };
    frameWindow.addEventListener('popstate', pop);
    return () => frameWindow.removeEventListener('popstate', pop);
  }, [base, frameWindow, navigate, origin]);

  useEffect(() => {
    if (!isCurrentData || !routeNavigationRef.current) return;
    const nav = routeNavigationRef.current;
    routeNavigationRef.current = null;
    if (nav.scroll) {
      const selector = route.id ? '.reader-hero, .reader-detail' : '.reader-feed';
      frameWindow.document.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: 'start' });
    }
    const target = nav.focus
      ? frameWindow.document.querySelector<HTMLElement>(nav.focus)
      : frameWindow.document.querySelector<HTMLElement>('.reader-detail-title, .reader-feed-heading h2');
    if (target) {
      if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }, [frameWindow, isCurrentData, route.id, routeKey]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPublicJSON(`${backendBase}/public/site`, controller.signal, t.public.siteConfigFailed)
      .then((value) => {
        const next = readSiteConfig(value);
        setSite(next);
        setQuote(next.description);
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : t.public.siteConfigFailed);
        }
      });
    return () => controller.abort();
  }, [backendBase, t.public.siteConfigFailed]);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    setList(null);
    setDetail(null);
    setLoadedFor('');
    const query = route.query.toString();
    const endpoint = route.id
      ? `${backendBase}/public/articles/${route.id}`
      : `${backendBase}/public/articles${query ? `?${query}` : ''}`;
    void fetchPublicJSON(endpoint, controller.signal, t.public.readFailed)
      .then((value) => {
        if (route.id) setDetail(restorePublicArticleDetail(value));
        else setList(restorePublicArticleList(value));
        setLoadedFor(routeKey);
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : t.public.readFailed);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [backendBase, route.id, route.query, routeKey, t.public.readFailed]);

  useEffect(() => {
    const themeChoice = appearance.theme;
    const media = frameWindow.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = themeChoice === 'auto' ? (media.matches ? 'dark' : 'light') : themeChoice;
      frameWindow.document.documentElement.dataset.theme = theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance.theme, frameWindow]);

  useEffect(() => {
    const button = backTopRef.current;
    if (!button) return;
    const reducedMotion = frameWindow.matchMedia('(prefers-reduced-motion: reduce)');
    let returning = false;
    let keyboardActivation = false;
    let frame = 0;
    let flight: Animation | undefined;
    const hasContent = () => !!frameWindow.document.querySelector('.reader-hero, .reader-feed, .reader-detail');
    const reset = () => {
      frameWindow.cancelAnimationFrame(frame);
      frame = 0;
      flight?.cancel();
      flight = undefined;
      returning = false;
      keyboardActivation = false;
      button.classList.remove('is-launching');
      button.removeAttribute('aria-busy');
    };
    const finish = () => {
      if (keyboardActivation)
        frameWindow.document.querySelector<HTMLElement>('.reader-brand')?.focus({ preventScroll: true });
      reset();
      update();
    };
    const update = () => {
      if (frameWindow.document.hidden || !hasContent()) {
        reset();
        setBackTop(false);
        return;
      }
      setBackTop(returning || frameWindow.scrollY >= 120);
      if (!returning || frame || frameWindow.scrollY > 1 || flight || typeof button.animate !== 'function') return;
      const animation = button.animate(
        [
          { transform: 'translateY(0)', opacity: 1 },
          { transform: 'translateY(-70vh)', opacity: 0 },
        ],
        { duration: reducedMotion.matches ? 320 : 500, easing: 'ease-in', fill: 'forwards' },
      );
      flight = animation;
      void animation.finished
        .then(() => {
          if (flight === animation) finish();
        })
        .catch(() => undefined);
    };
    const scrollUp = (event: MouseEvent) => {
      if (returning) return;
      returning = true;
      keyboardActivation = event.detail === 0;
      button.classList.add('is-launching');
      button.setAttribute('aria-busy', 'true');
      const from = frameWindow.scrollY;
      const started = frameWindow.performance.now();
      const duration = reducedMotion.matches ? 360 : 650;
      const step = (now: number) => {
        if (!returning || frameWindow.document.hidden || !hasContent()) {
          reset();
          update();
          return;
        }
        const progress = Math.min(1, (now - started) / duration);
        frameWindow.scrollTo({ top: (from * (1 + Math.cos(Math.PI * progress))) / 2, behavior: 'instant' });
        if (progress < 1) frame = frameWindow.requestAnimationFrame(step);
        else {
          frame = 0;
          update();
        }
      };
      frame = frameWindow.requestAnimationFrame(step);
      update();
    };
    const interrupt = () => {
      if (!returning) return;
      reset();
      frameWindow.scrollTo({ top: frameWindow.scrollY, behavior: 'instant' });
      update();
    };
    const interruptKeys = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Escape'].includes(event.key)) interrupt();
    };
    button.addEventListener('click', scrollUp);
    frameWindow.addEventListener('scroll', update, { passive: true });
    frameWindow.addEventListener('resize', update);
    frameWindow.addEventListener('wheel', interrupt, { passive: true });
    frameWindow.addEventListener('keydown', interruptKeys);
    frameWindow.document.addEventListener('visibilitychange', update);
    frameWindow.addEventListener('pageshow', update);
    reducedMotion.addEventListener('change', update);
    update();
    return () => {
      button.removeEventListener('click', scrollUp);
      frameWindow.removeEventListener('scroll', update);
      frameWindow.removeEventListener('resize', update);
      frameWindow.removeEventListener('wheel', interrupt);
      frameWindow.removeEventListener('keydown', interruptKeys);
      frameWindow.document.removeEventListener('visibilitychange', update);
      frameWindow.removeEventListener('pageshow', update);
      reducedMotion.removeEventListener('change', update);
      reset();
    };
  }, [frameWindow]);

  useEffect(() => {
    const controller = new AbortController();
    setQuoteLoading(true);
    void fetchPublicJSON(`${backendBase}/public/site/quote`, controller.signal, t.public.quoteFailed)
      .then((value) => {
        if (!isRecord(value) || value.ok !== true) return;
        const text = cleanText(value.text);
        if (site.quote.mode === 'api' && text.trim() && [...text].length <= 240) setQuote(text);
        if (Array.isArray(value.items)) {
          setQuotes(
            value.items
              .flatMap((item) => {
                const message = isRecord(item) ? cleanText(item.text) : '';
                return message.trim() && [...message].length <= 240 ? [message] : [];
              })
              .slice(0, 30),
          );
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setQuoteLoading(false);
      });
    return () => controller.abort();
  }, [backendBase, site.quote.mode, t.public.quoteFailed]);

  const selectedTaxonomy = activeList?.taxonomies.find((item) => item.id === Number(route.query.get('taxonomy')));
  const documentTitle = activeDetail?.article.title
    ? `${activeDetail.article.title} · ${site.name}`
    : t.public.docTitleArticle(site.name);
  const heroKind = route.id
    ? 'detail'
    : selectedTaxonomy
      ? selectedTaxonomy.kind === 'category'
        ? 'categories'
        : 'tags'
      : route.query.get('month')
        ? 'archives'
        : currentView;
  const heroEnabled = site.banners.enabled !== false && site.banners[`${heroKind}Enabled`] !== false;
  const theme =
    appearance.theme === 'auto'
      ? frameWindow.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : appearance.theme;
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  const setQuery = (
    changes: Record<string, string | null>,
    reset = false,
    options: { scroll?: boolean; focus?: string } = {},
  ) => {
    const query = new URLSearchParams(reset ? '' : route.query);
    Object.entries(changes).forEach(([key, value]) =>
      value === null || value === '' ? query.delete(key) : query.set(key, value),
    );
    navigate(publicArticleURL(base, query), false, options);
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setQuery({ q: searchDraft.trim(), page: null }, false, { scroll: false, focus: '.reader-search input' });
  };
  const logoImage = safeID(site.logoImage) ? `${backendBase}/public/site/files/${site.logoImage}` : '';
  const activeView = selectedTaxonomy
    ? selectedTaxonomy.kind === 'category'
      ? 'categories'
      : 'tags'
    : route.query.get('month')
      ? 'archives'
      : currentView;

  useEffect(() => {
    frameWindow.document.title = documentTitle;
  }, [documentTitle, frameWindow]);

  const openZoom = useCallback((src: string, alt: string) => setZoom({ src, alt }), []);
  const closeZoom = useCallback(() => setZoom(undefined), []);
  const closeBarrage = useCallback(() => {
    setBarrageOpen(false);
    frameWindow.requestAnimationFrame(() => barrageTriggerRef.current?.focus({ preventScroll: true }));
  }, [frameWindow]);
  const openBarrage = useCallback(() => setBarrageOpen(true), []);

  const hero =
    !route.id && activeList ? (
      <PublicArticleHero
        site={site}
        kind={heroKind}
        backendBase={backendBase}
        quote={quote}
        frameWindow={frameWindow}
        triggerRef={barrageTriggerRef}
        onBarrage={openBarrage}
      />
    ) : null;
  const footer = <PublicArticleFooter site={site} backendBase={backendBase} />;

  return (
    <div className="article-blog">
      <header className="navbar navbar-default navbar-fixed-top reader-header">
        <div className="container reader-header-inner">
          <a
            className="navbar-brand reader-brand"
            href={base}
            title={site.name}
            onClick={(event) => followPublicArticleRoute(event, base, navigate)}
          >
            {logoImage ? <img src={logoImage} alt="" /> : null}
            <span className="reader-brand-name">{site.name}</span>
          </a>
          <nav aria-label={t.public.navAria}>
            <ul className="nav navbar-nav reader-nav">
              {(['home', 'archives', 'categories', 'tags'] as const).map((item) => (
                <li key={item}>
                  <a
                    href={item === 'home' ? base : `${base}?view=${item}`}
                    data-view={item}
                    aria-current={activeView === item ? 'page' : undefined}
                    onClick={(event) =>
                      followPublicArticleRoute(event, item === 'home' ? base : `${base}?view=${item}`, navigate)
                    }
                  >
                    {t.public.nav[item]}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <form className="reader-search" role="search" action={base} method="get" onSubmit={submitSearch}>
            {readerIcon('search')}
            <input
              type="search"
              name="q"
              maxLength={100}
              aria-label={t.public.searchArticlesAria}
              placeholder={t.public.searchArticlesPlaceholder}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.currentTarget.value)}
            />
            <button type="submit">{t.public.searchAction}</button>
          </form>
          <div className="reader-header-actions">
            <button
              className="reader-icon-button"
              type="button"
              aria-label={theme === 'dark' ? t.public.themeLight : t.public.themeDark}
              title={theme === 'dark' ? t.public.themeLight : t.public.themeDark}
              onClick={() => appearance.setTheme(nextTheme)}
            >
              {readerIcon(theme === 'dark' ? 'sun' : 'moon')}
            </button>
          </div>
        </div>
      </header>
      <main id="articleReader" aria-live="polite" aria-busy={loading}>
        {error ? (
          <div className="reader-message">
            <p>{error}</p>
            <a href={base} onClick={(event) => followPublicArticleRoute(event, base, navigate)}>
              {t.public.backHome}
            </a>
          </div>
        ) : loading ? (
          <p className="reader-message">{t.public.loading}</p>
        ) : null}
        {!error && !loading ? (
          <>
            {route.id && activeDetail ? (
              <PublicArticleHero
                site={site}
                kind="detail"
                backendBase={backendBase}
                quote={quote}
                frameWindow={frameWindow}
                triggerRef={barrageTriggerRef}
                onBarrage={openBarrage}
              />
            ) : null}
            {!route.id && activeList ? hero : null}
            {route.id && activeDetail ? (
              <PublicArticleDetail
                key={activeDetail.id}
                base={base}
                backendBase={backendBase}
                detail={activeDetail}
                noHero={!heroEnabled}
                onNavigate={navigate}
                onImageOpen={openZoom}
              />
            ) : null}
            {!route.id && activeList ? (
              <PublicArticleListView
                base={base}
                backendBase={backendBase}
                data={activeList}
                view={currentView}
                noHero={!heroEnabled}
                query={route.query}
                onNavigate={navigate}
              />
            ) : null}
            {!route.id && !activeList ? <p className="reader-message">{t.public.empty}</p> : null}
          </>
        ) : null}
      </main>
      {footer}
      <button
        ref={backTopRef}
        className="reader-back-top"
        type="button"
        aria-label={t.public.backTop}
        title={t.public.backTop}
        hidden={!backTop}
      >
        <span className="reader-rocket-body" aria-hidden="true" />
        <span className="reader-rocket-hover" aria-hidden="true" />
      </button>
      {barrageOpen ? (
        <PublicArticleBarrageDialog
          quotes={quotes}
          loading={quoteLoading}
          frameWindow={frameWindow}
          onClose={closeBarrage}
        />
      ) : null}
      {zoom ? <PublicArticleImageDialog src={zoom.src} alt={zoom.alt} onClose={closeZoom} /> : null}
    </div>
  );
}
