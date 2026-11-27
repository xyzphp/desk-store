import { MarkdownView, useMessages } from '@xyzos/desk-ui';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { PublicArticleDetail as PublicArticleData } from './publicArticleReader';
import { readerIcon } from './publicArticleIcons';
import { followPublicArticleRoute } from './publicArticleLinks';
import { currentLocale } from '../../shared/i18n/current';
import { articleMessages, articleText } from './locale';

function dateLabel(value: number) {
  return new Intl.DateTimeFormat(currentLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(value);
}

const labelColors = ['primary', 'success', 'info', 'warning', 'danger', 'mint', 'purple', 'pink', 'dark'];

export function PublicArticleDetail({
  base,
  backendBase,
  detail,
  noHero,
  onNavigate,
  onImageOpen,
}: {
  base: string;
  backendBase: string;
  detail: PublicArticleData;
  noHero: boolean;
  onNavigate: (path: string) => void;
  onImageOpen: (src: string, alt: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const t = useMessages(articleMessages);
  const category = detail.taxonomies.find((item) => item.id === detail.article.categoryId);
  const tags = detail.article.tagIds.flatMap((id) => {
    const item = detail.taxonomies.find((taxonomy) => taxonomy.id === id);
    return item ? [item] : [];
  });
  const privatePage = detail.article.visibility !== 'public';
  const coverId = detail.article.coverFileId;
  const coverPath = coverId ? `${backendBase}/public/articles/${detail.id}/files/${coverId}` : '';
  const [coverFailed, setCoverFailed] = useState(false);
  const square = detail.coverWidth && detail.coverHeight ? detail.coverWidth / detail.coverHeight < 1.45 : false;
  const media = Object.fromEntries(
    detail.files.map((file) => [
      file.id,
      {
        url: `${backendBase}/public/articles/${detail.id}/files/${Number(file.id.split(':')[1])}`,
        image: ['image/png', 'image/jpeg'].includes(file.mediaType),
      },
    ]),
  );
  const taxonomyLabel = (item: (typeof tags)[number], isCategory = false) => {
    const className = `label ${isCategory ? 'label-default' : `label-${labelColors[item.id % labelColors.length]}`}`;
    if (privatePage)
      return (
        <span key={item.id} className={className}>
          {item.name}
        </span>
      );
    return (
      <a
        key={item.id}
        className={className}
        href={`${base}?taxonomy=${item.id}`}
        onClick={(event) => followPublicArticleRoute(event, `${base}?taxonomy=${item.id}`, onNavigate)}
      >
        {item.name}
      </a>
    );
  };
  const attachments = detail.files.filter((file) => !coverId || Number(file.id.split(':')[1]) !== coverId);
  const zoom = (src: string, alt: string) => (event: MouseEvent<HTMLImageElement>) => {
    event.preventDefault();
    onImageOpen(src, alt);
  };
  const zoomOnKey = (src: string, alt: string) => (event: KeyboardEvent<HTMLImageElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onImageOpen(src, alt);
  };

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const cleanups = Array.from(root.querySelectorAll('img')).map((image) => {
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', articleText().public.zoomAria(image.alt || articleText().public.imageFallback));
      const open = () => {
        const source = image.getAttribute('src');
        if (source) onImageOpen(source, image.alt || articleText().public.imageFallback);
      };
      const keydown = (event: globalThis.KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      };
      image.addEventListener('click', open);
      image.addEventListener('keydown', keydown);
      return () => {
        image.removeEventListener('click', open);
        image.removeEventListener('keydown', keydown);
      };
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [detail.article.content, onImageOpen]);
  return (
    <>
      <div className={`reader-detail-layout${noHero ? ' no-hero' : ''}`}>
        <article className="reader-detail" aria-labelledby="readerArticleTitle">
          {coverPath && !coverFailed && !square ? (
            <div className="article-img reader-detail-banner is-banner">
              <img
                className="reader-detail-banner-img"
                src={coverPath}
                alt={detail.article.title}
                role="button"
                tabIndex={0}
                aria-label={t.public.zoomAria(detail.article.title)}
                onClick={zoom(coverPath, detail.article.title)}
                onKeyDown={zoomOnKey(coverPath, detail.article.title)}
                onError={() => setCoverFailed(true)}
              />
            </div>
          ) : null}
          <header className="article-head">
            <div className="reader-head-body">
              <div className="reader-head-main">
                <h1 id="readerArticleTitle" className="reader-detail-title">
                  {readerIcon('book')}
                  {detail.article.title}
                </h1>
                {detail.article.summary ? <small className="reader-summary">{detail.article.summary}</small> : null}
                <div className="article-date reader-byline">
                  <time dateTime={new Date(detail.publishedAt).toISOString()}>
                    {readerIcon('calendar')}
                    {dateLabel(detail.publishedAt)}
                  </time>
                  <span>
                    {readerIcon('user')}
                    {detail.author}
                  </span>
                  {privatePage ? <span className="label label-default">{t.public.privateBadge}</span> : null}
                </div>
                <div className="article-tag reader-detail-tags">
                  {category ? taxonomyLabel(category, true) : null}
                  {tags.map((tag) => taxonomyLabel(tag))}
                </div>
              </div>
              {coverPath && !coverFailed && square ? (
                <div className="reader-detail-square is-square">
                  <img
                    className="reader-detail-square-img"
                    src={coverPath}
                    alt={detail.article.title}
                    role="button"
                    tabIndex={0}
                    aria-label={t.public.zoomAria(detail.article.title)}
                    onClick={zoom(coverPath, detail.article.title)}
                    onKeyDown={zoomOnKey(coverPath, detail.article.title)}
                    onError={() => setCoverFailed(true)}
                  />
                </div>
              ) : null}
            </div>
          </header>
          <MarkdownView
            as="div"
            className="article-entry reader-content"
            ref={contentRef}
            value={detail.article.content}
            media={media}
          />
          {attachments.length ? (
            <section className="article-footer reader-attachments">
              <h2>{t.public.attachmentsTitle}</h2>
              {attachments.map((file) => {
                const url = `${backendBase}/public/articles/${detail.id}/files/${Number(file.id.split(':')[1])}?download=1`;
                return (
                  <a key={file.id} href={url}>
                    <span>{file.name}</span>
                    <span>{t.public.attachmentSize((file.size / 1024).toFixed(1))}</span>
                  </a>
                );
              })}
            </section>
          ) : null}
          <nav aria-label={t.public.navAria}>
            <ul className="pager reader-detail-pager">
              <li className="previous">
                <a href={base} onClick={(event) => followPublicArticleRoute(event, base, onNavigate)}>
                  {t.public.backToHome}
                </a>
              </li>
            </ul>
          </nav>
        </article>
      </div>
    </>
  );
}
