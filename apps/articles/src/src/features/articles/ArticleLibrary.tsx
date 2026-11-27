import { useState } from 'react';
import { Icon, useMessages } from '@xyzos/desk-ui';
import { AppImage } from '../../shared/sdk/media';
import { categoryPath } from './model';
import type { useArticles } from './useArticles';
import { currentLocale } from '../../shared/i18n/current';
import { articleMessages, type ArticleMessages } from './locale';

type ArticleState = ReturnType<typeof useArticles>;

const date = (time: number) =>
  new Intl.DateTimeFormat(currentLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(time),
  );

function statusLabel(item: ArticleState['visible'][number], t: ArticleMessages) {
  if (item.trashedAt) return t.library.status.trashed;
  if (!item.publishedAt) return t.library.status.draft;
  if (item.changed) return t.library.status.changed;
  return item.visibility === 'public' ? t.library.status.public : t.library.status.private;
}

type ArticleItem = ArticleState['visible'][number];

function ArticleRow({ item, state }: { item: ArticleItem; state: ArticleState }) {
  const t = useMessages(articleMessages);
  const selected = state.record?.id === item.id;
  const taxonomies = state.catalog?.taxonomies ?? [];
  const taxonomy = taxonomies.find((entry) => entry.id === item.categoryId);
  const hasChildren =
    !!taxonomy && taxonomies.some((entry) => entry.kind === 'category' && entry.parentId === taxonomy.id);
  const [thumbFailed, setThumbFailed] = useState(false);
  const publicArticle = !!item.publishedAt && item.visibility === 'public' && !item.trashedAt;
  const thumb = !item.trashedAt && item.coverFileId > 0 && !thumbFailed;
  return (
    <div className="ar-list-item" role="listitem">
      <button
        type="button"
        className={`ar-article-row${selected ? ' is-selected' : ''}`}
        data-ar-select={item.id}
        aria-pressed={selected}
        onClick={() => void state.selectArticle(item.id)}
      >
        <span className={`ar-article-glyph${thumb ? ' is-thumb' : ''}`} aria-hidden="true">
          {thumb ? (
            <AppImage
              className="ar-article-thumb"
              fileId={item.coverFileId}
              alt=""
              loading="lazy"
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <Icon
              className="xyz-icon lucide"
              name={item.trashedAt ? 'trash-2' : item.coverFileId > 0 ? 'image' : 'file-text'}
            />
          )}
        </span>
        <div className="ar-article-content">
          <strong className="ar-article-title">{item.title || t.library.untitled}</strong>
          <div className="ar-article-meta">
            <span className="ar-article-meta-left">
              {taxonomy && (
                <span className="ar-article-category" title={categoryPath(taxonomy, taxonomies)}>
                  <Icon className="xyz-icon lucide" name={hasChildren ? 'folder-open' : 'folder'} />
                  {taxonomy.name}
                </span>
              )}
              <time dateTime={new Date(item.updatedAt).toISOString()}>{date(item.updatedAt)}</time>
            </span>
            <span className={`ar-badge${publicArticle ? ' is-public' : ''}`}>{statusLabel(item, t)}</span>
          </div>
        </div>
      </button>
    </div>
  );
}

function ArticleCard({ item, state }: { item: ArticleItem; state: ArticleState }) {
  const t = useMessages(articleMessages);
  const selected = state.record?.id === item.id;
  const taxonomy = state.catalog?.taxonomies.find((entry) => entry.id === item.categoryId);
  // 与原站一致：封面尺寸未知时先按横幅卡片排版，图片加载后按实际宽高比改成侧图卡片。
  const [measured, setMeasured] = useState(0);
  const known = item.coverWidth > 0 && item.coverHeight > 0 ? item.coverWidth / item.coverHeight : 0;
  const ratio = measured || known;
  const wide = !ratio || ratio >= 1.45;
  const cardClass = item.coverFileId ? (wide ? 'is-banner-card' : 'is-side-card') : 'is-text-card';
  const publicArticle = !!item.publishedAt && item.visibility === 'public' && !item.trashedAt;
  return (
    <div className="ar-list-item" role="listitem">
      <button
        type="button"
        className={`ar-mp-card ${cardClass}${selected ? ' is-selected' : ''}`}
        data-ar-select={item.id}
        aria-pressed={selected}
        onClick={() => void state.selectArticle(item.id)}
      >
        {item.coverFileId > 0 && (
          <div className={wide ? 'ar-mp-cover' : 'ar-mp-side-cover'}>
            <AppImage
              className="ar-mp-cover-img"
              fileId={item.coverFileId}
              alt=""
              loading="lazy"
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth && naturalHeight) setMeasured(naturalWidth / naturalHeight);
              }}
            />
            <span className={`ar-mp-badge${publicArticle ? ' is-public' : ''}`}>{statusLabel(item, t)}</span>
            <div className="ar-mp-overlay">
              <strong className="ar-mp-overlay-title">{item.title || t.library.untitled}</strong>
            </div>
          </div>
        )}
        <div className="ar-mp-body">
          <strong className="ar-mp-title" title={item.title || t.library.untitled}>
            {item.title || t.library.untitled}
          </strong>
          <div className="ar-mp-meta">
            <span className="ar-mp-meta-left">
              {taxonomy && (
                <span className="ar-mp-category" title={categoryPath(taxonomy, state.catalog?.taxonomies ?? [])}>
                  <Icon className="xyz-icon lucide" name="folder" />
                  {taxonomy.name}
                </span>
              )}
              <time dateTime={new Date(item.updatedAt).toISOString()}>{date(item.updatedAt)}</time>
            </span>
            {!item.coverFileId && (
              <span className={`ar-badge-pill${publicArticle ? ' is-public' : ''}`}>{statusLabel(item, t)}</span>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}

export function ArticleLibrary({ state }: { state: ArticleState }) {
  const t = useMessages(articleMessages);
  const title = state.siteOpen
    ? t.library.titles.site
    : state.view === 'all'
      ? t.library.titles.all
      : state.view === 'draft'
        ? t.library.titles.draft
        : state.view === 'private'
          ? t.library.titles.private
          : state.view === 'public'
            ? t.library.titles.public
            : t.library.titles.trash;
  return (
    <section
      className="ar-library"
      style={{ width: state.libraryWidth }}
      hidden={state.libraryCollapsed || state.siteOpen}
    >
      <header>
        <strong data-ar-list-title>{title}</strong>
        <div className="ar-library-header-actions">
          <div className="ar-list-layout-switch" role="group" aria-label={t.library.layoutGroup}>
            <button
              type="button"
              data-ar-layout="card"
              aria-pressed={state.layout === 'card'}
              aria-label={t.library.cardView}
              title={t.library.cardView}
              onClick={() => state.setLayout('card')}
            >
              <Icon className="xyz-icon lucide" name="layout-grid" />
            </button>
            <button
              type="button"
              data-ar-layout="list"
              aria-pressed={state.layout === 'list'}
              aria-label={t.library.rowView}
              title={t.library.rowView}
              onClick={() => state.setLayout('list')}
            >
              <Icon className="xyz-icon lucide" name="list" />
            </button>
          </div>
          <button
            type="button"
            data-ar-new
            aria-label={t.library.newArticle}
            title={t.library.newArticle}
            onClick={() => void state.createDraft()}
          >
            <Icon className="xyz-icon lucide" name="pencil" />
          </button>
          <button
            type="button"
            className="ar-library-toggle-btn"
            data-ar-toggle-library
            aria-label={t.library.collapse}
            title={t.library.collapse}
            aria-pressed={!state.libraryCollapsed}
            onClick={() => state.setLibraryCollapsed(true)}
          >
            <Icon className="xyz-icon lucide" name="panel-right-close" />
          </button>
        </div>
      </header>
      <label className="ar-search">
        <Icon className="xyz-icon lucide" name="search" />
        <input
          type="search"
          data-ar-search
          maxLength={100}
          placeholder={t.library.searchPlaceholder}
          aria-label={t.library.searchAria}
          value={state.query}
          onChange={(event) => state.setQuery(event.currentTarget.value)}
        />
      </label>
      {state.error && (
        <p className="ar-status is-error" role="alert">
          {state.error}
        </p>
      )}
      <div
        className={`ar-list${state.layout === 'list' ? ' is-list-view' : ''}`}
        data-ar-list
        role="list"
        aria-label={t.library.listAria}
      >
        {state.loading ? (
          <div className="ar-empty-list" role="status">
            {t.library.loading}
          </div>
        ) : state.visible.length > 0 ? (
          state.visible.map((item) =>
            state.layout === 'list' ? (
              <ArticleRow key={item.id} item={item} state={state} />
            ) : (
              <ArticleCard key={item.id} item={item} state={state} />
            ),
          )
        ) : (
          <div className="ar-empty-list">
            <Icon className="xyz-icon lucide" name="files" />
            <span>{t.library.empty}</span>
          </div>
        )}
      </div>
      <footer data-ar-count>{t.library.count(state.visible.length)}</footer>
    </section>
  );
}
