import { useState, type MouseEvent, type ReactNode } from 'react';
import { useMessages } from '@xyzos/desk-ui';
import type {
  PublicArticleArchive,
  PublicArticleList,
  PublicArticleSummary,
  PublicArticleTaxonomy,
  PublicArticleView,
} from './publicArticleReader';
import { usePublicArticleTagCloud } from './usePublicArticleTagCloud';
import { followPublicArticleRoute } from './publicArticleLinks';
import { currentLocale } from '../../shared/i18n/current';
import { articleMessages, articleText, type ArticleMessages } from './locale';

const labelColors = ['primary', 'success', 'info', 'warning', 'danger', 'mint', 'purple', 'pink', 'dark'];

function icon(name: 'calendar' | 'user' | 'folder' | 'tag' | 'close' | 'left' | 'right' | 'lock') {
  const paths = {
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
    tag: (
      <>
        <path d="m20 13-7 7a2 2 0 0 1-3 0L3 13V3h10l7 7a2 2 0 0 1 0 3Z" />
        <circle cx="7.5" cy="7.5" r=".5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    left: <path d="m14 6-6 6 6 6" />,
    right: <path d="m10 6 6 6-6 6" />,
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function monthName(value: string, t: ArticleMessages) {
  return t.public.monthName(value.slice(0, 4), Number(value.slice(5)));
}

function dateLabel(value: number) {
  return new Intl.DateTimeFormat(currentLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(value);
}

function taxonomyPath(items: readonly PublicArticleTaxonomy[], id: number) {
  return items.find((item) => item.id === id);
}

function taxonomyLink(
  taxonomy: PublicArticleTaxonomy,
  selected: boolean,
  href: string,
  onNavigate: (href: string) => void,
  className = 'reader-tag',
  cloud = false,
  t = articleText(),
) {
  return (
    <a
      key={taxonomy.id}
      className={`${className} label label-${labelColors[taxonomy.id % labelColors.length]}${selected ? ' is-active' : ''}`}
      href={href}
      aria-label={t.public.taxonomyAria(taxonomy.name, taxonomy.count)}
      aria-current={selected ? 'true' : undefined}
      onClick={(event) => followPublicArticleRoute(event, href, onNavigate)}
    >
      <span>{taxonomy.name}</span>
      {cloud ? null : <small>{taxonomy.count}</small>}
    </a>
  );
}

function activeFilter(text: string, key: string, href: string, onNavigate: (href: string) => void, t: ArticleMessages) {
  return (
    <a
      key={key}
      className="reader-filter"
      href={href}
      aria-label={t.public.clearFilter(text)}
      onClick={(event) => followPublicArticleRoute(event, href, onNavigate)}
    >
      {text}
      {icon('close')}
    </a>
  );
}

function PublicArticlePost({
  item,
  taxonomies,
  base,
  backendBase,
  onNavigate,
}: {
  item: PublicArticleSummary;
  taxonomies: readonly PublicArticleTaxonomy[];
  base: string;
  backendBase: string;
  onNavigate: (href: string) => void;
}) {
  const t = useMessages(articleMessages);
  const [coverFailed, setCoverFailed] = useState(false);
  const [isBanner, setIsBanner] = useState(
    item.coverWidth && item.coverHeight ? item.coverWidth / item.coverHeight >= 1.45 : true,
  );
  const category = taxonomyPath(taxonomies, item.categoryId);
  const tags = item.tagIds.flatMap((id) => {
    const selected = taxonomyPath(taxonomies, id);
    return selected ? [selected] : [];
  });
  const href = `${base}/${item.id}`;
  const hasCover = item.coverFileId !== undefined && !coverFailed;
  const cardMode = hasCover ? (isBanner ? 'is-banner-card' : 'is-side-card') : 'is-text-card';
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    followPublicArticleRoute(event, href, onNavigate);
  };
  return (
    <article className={`reader-post reader-mp-card ${cardMode}${item.visibility === 'private' ? ' is-private' : ''}`}>
      {hasCover ? (
        <a className="reader-mp-cover-wrap" href={href} aria-label={item.title} onClick={open}>
          <div className="reader-mp-cover">
            <img
              className="reader-mp-cover-img"
              loading="lazy"
              src={`${backendBase}/public/articles/${item.id}/files/${item.coverFileId}`}
              alt={item.title}
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth && image.naturalHeight)
                  setIsBanner(image.naturalWidth / image.naturalHeight >= 1.45);
              }}
              onError={() => setCoverFailed(true)}
            />
            {item.visibility === 'private' ? (
              <span className="reader-mp-badge is-private">
                {icon('lock')} {t.public.privateBadge}
              </span>
            ) : null}
            <div className="reader-mp-overlay">
              <h2 className="reader-mp-overlay-title">{item.title}</h2>
            </div>
          </div>
        </a>
      ) : null}
      <div className="reader-mp-content">
        <h2 className="reader-mp-title">
          <a href={href} onClick={open}>
            {item.title}
          </a>
        </h2>
        <div className="reader-mp-footer">
          <div className="reader-mp-meta">
            <time dateTime={new Date(item.publishedAt).toISOString()}>
              {icon('calendar')}
              {dateLabel(item.publishedAt)}
            </time>
            <span>
              {icon('user')}
              {item.author}
            </span>
          </div>
          <div className="reader-mp-tags">
            {category ? (
              <a
                className="reader-pill label label-default"
                href={`${base}?taxonomy=${category.id}`}
                onClick={(event) => followPublicArticleRoute(event, `${base}?taxonomy=${category.id}`, onNavigate)}
              >
                {category.name}
              </a>
            ) : null}
            {tags.map((tag) => (
              <a
                key={tag.id}
                className={`reader-pill label label-${labelColors[tag.id % labelColors.length]}`}
                href={`${base}?taxonomy=${tag.id}`}
                onClick={(event) => followPublicArticleRoute(event, `${base}?taxonomy=${tag.id}`, onNavigate)}
              >
                {tag.name}
              </a>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function pagination(
  data: PublicArticleList,
  hrefFor: (page: number) => string,
  onNavigate: (href: string) => void,
  t: ArticleMessages,
) {
  const pages = Math.max(1, Math.ceil(data.total / 20));
  if (pages === 1 && data.page === 1) return null;
  const numbers = [...new Set([1, data.page - 1, data.page, data.page + 1, pages])]
    .filter((number) => number > 0 && number <= pages)
    .sort((a, b) => a - b);
  let previous = 0;
  const nodes: ReactNode[] = [];
  if (data.page > 1) {
    nodes.push(
      <a
        key="previous"
        href={hrefFor(data.page - 1)}
        aria-label={t.public.previousPage}
        onClick={(event) => followPublicArticleRoute(event, hrefFor(data.page - 1), onNavigate)}
      >
        {icon('left')}
      </a>,
    );
  }
  numbers.forEach((number) => {
    if (previous && number > previous + 1)
      nodes.push(
        <span key={`gap-${number}`} aria-hidden="true">
          …
        </span>,
      );
    previous = number;
    nodes.push(
      <a
        key={number}
        href={hrefFor(number)}
        aria-current={number === data.page ? 'page' : undefined}
        aria-label={t.public.pageAria(number)}
        onClick={(event) => followPublicArticleRoute(event, hrefFor(number), onNavigate)}
      >
        {number}
      </a>,
    );
  });
  if (data.more) {
    nodes.push(
      <a
        key="next"
        href={hrefFor(data.page + 1)}
        aria-label={t.public.nextPage}
        onClick={(event) => followPublicArticleRoute(event, hrefFor(data.page + 1), onNavigate)}
      >
        {icon('right')}
      </a>,
    );
  }
  return (
    <nav className="reader-pagination" aria-label={t.public.paginationAria}>
      {nodes}
    </nav>
  );
}

export function PublicArticleListView({
  base,
  backendBase,
  data,
  view,
  noHero,
  query,
  onNavigate,
}: {
  base: string;
  backendBase: string;
  data: PublicArticleList;
  view: PublicArticleView;
  noHero: boolean;
  query: URLSearchParams;
  onNavigate: (href: string) => void;
}) {
  const t = useMessages(articleMessages);
  const categories = data.taxonomies.filter((item) => item.kind === 'category');
  const tags = data.taxonomies.filter((item) => item.kind === 'tag');
  const tagCloudRef = usePublicArticleTagCloud(tags.map((item) => `${item.id}:${item.name}`).join(','));
  const selected = data.taxonomies.find((item) => item.id === Number(query.get('taxonomy')));
  const currentView = selected
    ? selected.kind === 'category'
      ? 'categories'
      : 'tags'
    : query.get('month')
      ? 'archives'
      : view;
  const single = currentView !== 'home';
  const title =
    selected?.name ?? (query.get('month') ? monthName(query.get('month')!, t) : t.public.viewTitles[currentView]);
  const next = (change: Record<string, string | null>, reset = false) => {
    const params = new URLSearchParams(reset ? '' : query);
    Object.entries(change).forEach(([key, value]) =>
      value === null || value === '' ? params.delete(key) : params.set(key, value),
    );
    onNavigate(`${base}${params.size ? `?${params.toString()}` : ''}`);
  };
  const filters = [
    query.get('q')
      ? activeFilter(
          query.get('q')!,
          'q',
          (() => {
            const copy = new URLSearchParams(query);
            copy.delete('q');
            copy.delete('page');
            return `${base}?${copy}`;
          })(),
          onNavigate,
          t,
        )
      : null,
    query.get('month')
      ? activeFilter(
          monthName(query.get('month')!, t),
          'month',
          (() => {
            const copy = new URLSearchParams(query);
            copy.delete('month');
            copy.delete('page');
            return `${base}?${copy}`;
          })(),
          onNavigate,
          t,
        )
      : null,
    query.get('taxonomy')
      ? activeFilter(
          selected?.name ?? t.public.fallbackFilter,
          'taxonomy',
          (() => {
            const copy = new URLSearchParams(query);
            copy.delete('taxonomy');
            copy.delete('page');
            return `${base}?${copy}`;
          })(),
          onNavigate,
          t,
        )
      : null,
  ].filter(Boolean);
  const hrefForPage = (page: number) => {
    const params = new URLSearchParams(query);
    params.set('page', String(page));
    return `${base}?${params.toString()}`;
  };
  const taxonomyBrowser =
    !selected && ['categories', 'tags'].includes(currentView)
      ? (currentView === 'categories' ? categories : tags).map((item) =>
          taxonomyLink(
            item,
            false,
            (() => {
              const params = new URLSearchParams(query);
              params.set('taxonomy', String(item.id));
              params.delete('page');
              return `${base}?${params.toString()}`;
            })(),
            onNavigate,
            'reader-tag',
            false,
            t,
          ),
        )
      : [];
  return (
    <div className={`container reader-layout${single ? ' is-single' : ''}${noHero ? ' no-hero' : ''}`}>
      <div className="rows">
        <section className="col-lg-8 reader-feed" aria-label={t.public.feedAria}>
          <header className={`reader-feed-head${!single && !filters.length ? ' is-home-head' : ''}`}>
            <div className="reader-feed-heading">
              <h2>
                {single ? (
                  <>
                    {icon(currentView === 'categories' ? 'folder' : currentView === 'tags' ? 'tag' : 'calendar')}
                    {title}
                  </>
                ) : (
                  title
                )}
              </h2>
              <span className="reader-count">{t.public.count(data.total)}</span>
            </div>
            {/* As in the original reader.js, the month filter is only appended to the feed head under a category / tag
                filter. The reader lives in an iframe that loads blog styles only, so use a native select styled by
                reader.css (.reader-month-filter) instead of the component-library Select. */}
            {selected && data.archives.length ? (
              <select
                className="reader-month-filter"
                aria-label={t.public.monthFilterAria}
                value={query.get('month') ?? ''}
                onChange={(event) => next({ month: event.currentTarget.value || null, page: null })}
              >
                <option value="">{t.public.allMonths}</option>
                {data.archives.map((archive) => (
                  <option key={archive.month} value={archive.month}>
                    {monthName(archive.month, t)} · {archive.count}
                  </option>
                ))}
              </select>
            ) : null}
          </header>
          {filters.length ? <div className="reader-active-filters">{filters}</div> : null}
          {taxonomyBrowser.length ? (
            <nav className="reader-taxonomy-browser" aria-label={title}>
              {taxonomyBrowser.length ? (
                taxonomyBrowser
              ) : (
                <span className="reader-side-empty">{t.public.emptyTaxonomyBrowser}</span>
              )}
            </nav>
          ) : null}
          {currentView === 'archives' && !query.get('month') ? (
            <nav className="reader-taxonomy-browser" aria-label={t.public.archiveAria}>
              {data.archives.map((archive: PublicArticleArchive) => {
                const params = new URLSearchParams(query);
                params.set('view', 'archives');
                params.set('month', archive.month);
                params.delete('page');
                const href = `${base}?${params.toString()}`;
                return (
                  <a
                    key={archive.month}
                    className="reader-filter"
                    href={href}
                    onClick={(event) => followPublicArticleRoute(event, href, onNavigate)}
                  >
                    {monthName(archive.month, t)} <span>{archive.count}</span>
                  </a>
                );
              })}
            </nav>
          ) : null}
          <div className="reader-list">
            {data.items.length ? (
              data.items.map((item) => (
                <PublicArticlePost
                  key={`${item.id}:${item.coverFileId ?? 0}:${item.coverWidth ?? 0}:${item.coverHeight ?? 0}`}
                  item={item}
                  taxonomies={data.taxonomies}
                  base={base}
                  backendBase={backendBase}
                  onNavigate={onNavigate}
                />
              ))
            ) : (
              <div className="reader-message">
                <h3>{filters.length ? t.public.noMatch : t.public.empty}</h3>
                {filters.length ? (
                  <a href={base} onClick={(event) => followPublicArticleRoute(event, base, onNavigate)}>
                    {t.public.viewAll}
                  </a>
                ) : null}
              </div>
            )}
          </div>
          {pagination(data, hrefForPage, onNavigate, t)}
          <ul className="pager reader-list-pager">
            <li className={`previous${data.page > 1 ? '' : ' disabled'}`}>
              {data.page > 1 ? (
                <a
                  href={hrefForPage(data.page - 1)}
                  onClick={(event) => followPublicArticleRoute(event, hrefForPage(data.page - 1), onNavigate)}
                >
                  {t.public.pagerNewer}
                </a>
              ) : (
                <span>{t.public.pagerNewer}</span>
              )}
            </li>
            <li className={`next${data.more ? '' : ' disabled'}`}>
              {data.more ? (
                <a
                  href={hrefForPage(data.page + 1)}
                  onClick={(event) => followPublicArticleRoute(event, hrefForPage(data.page + 1), onNavigate)}
                >
                  {t.public.pagerOlder}
                </a>
              ) : (
                <span>{t.public.pagerOlder}</span>
              )}
            </li>
          </ul>
        </section>
        {single ? null : (
          <aside className="col-lg-4 reader-sidebar" aria-label={t.public.asideAria}>
            <section className="panel panel-primary reader-side-panel" data-kind="archive">
              <div className="panel-heading">
                <h2 className="panel-title">
                  {icon('calendar')}
                  {t.public.archivePanelTitle}
                </h2>
              </div>
              <div className="list-group reader-side-links">
                {data.archives.map((archive) => {
                  const params = new URLSearchParams({ view: 'archives', month: archive.month });
                  const href = `${base}?${params.toString()}`;
                  return (
                    <a
                      key={archive.month}
                      className={`list-group-item${query.get('month') === archive.month ? ' is-active' : ''}`}
                      href={href}
                      onClick={(event) => followPublicArticleRoute(event, href, onNavigate)}
                    >
                      {icon('calendar')}
                      <span>{monthName(archive.month, t)}</span>
                      <b className="badge label-primary">{archive.count}</b>
                    </a>
                  );
                })}
                {!data.archives.length ? <p className="reader-side-empty">{t.public.emptyArchives}</p> : null}
              </div>
            </section>
            <section className="panel panel-danger reader-side-panel" data-kind="category">
              <div className="panel-heading">
                <h2 className="panel-title">
                  {icon('folder')}
                  {t.public.categoryPanelTitle}
                </h2>
              </div>
              <div className="list-group reader-side-links">
                {categories.map((item) =>
                  taxonomyLink(
                    item,
                    selected?.id === item.id,
                    `${base}?taxonomy=${item.id}`,
                    onNavigate,
                    'list-group-item',
                    false,
                    t,
                  ),
                )}
                {!categories.length ? <p className="reader-side-empty">{t.public.emptyCategories}</p> : null}
              </div>
            </section>
            <section className="panel panel-success reader-side-panel" data-kind="tag">
              <div className="panel-heading">
                <h2 className="panel-title">
                  {icon('tag')}
                  {t.public.tagPanelTitle}
                </h2>
              </div>
              <div ref={tagCloudRef} id="tag_cloud_widget" className="reader-tags">
                {tags.map((item) =>
                  taxonomyLink(
                    item,
                    selected?.id === item.id,
                    `${base}?taxonomy=${item.id}`,
                    onNavigate,
                    'reader-tag',
                    true,
                    t,
                  ),
                )}
                {!tags.length ? <p className="reader-side-empty">{t.public.emptyTags}</p> : null}
              </div>
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}
