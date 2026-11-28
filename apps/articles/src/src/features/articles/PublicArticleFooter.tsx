import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { useMessages } from '@xyzos/desk-ui';
import {
  cleanPublicText,
  isPublicRecord,
  safePublicImageID,
  type PublicArticleSiteConfig,
} from './publicArticleConfig';
import { readerIcon } from './publicArticleIcons';
import { articleMessages } from './locale';
import { groupArticleFooterItems, readArticleFooterItems } from './footerItems';
import { articleFooterBackgroundFallback, articleFooterTextFallback } from './siteStyleDefaults';

const labelColors = ['primary', 'success', 'info', 'warning', 'danger', 'mint', 'purple', 'pink', 'dark'];

function PublicArticleFooter({
  site,
  base,
  backendBase,
}: {
  site: PublicArticleSiteConfig;
  base: string;
  backendBase: string;
}) {
  const t = useMessages(articleMessages);
  const footer = site.footer;
  if (footer.enabled === false) return null;
  const columns = Array.isArray(footer.columns)
    ? footer.columns.filter((item): item is Record<string, unknown> => isPublicRecord(item) && item.enabled !== false)
    : [];
  const bgMode = cleanPublicText(footer.bgMode, 'repeat') || 'repeat';
  const imageID = safePublicImageID(footer.bgImage) ? Number(footer.bgImage) : 0;
  const bgImageURL =
    typeof footer.bgImageUrl === 'string' && /^https?:\/\//i.test(footer.bgImageUrl) ? footer.bgImageUrl : '';
  const defaultBgUrl = `${base.replace(/\/+$/, '')}/theme/footer_bg_01.png`;
  const image =
    bgMode === 'none'
      ? 'none'
      : `url("${imageID ? `${backendBase}/public/site/files/${imageID}` : bgImageURL || defaultBgUrl}")`;
  const style = {
    '--footer-bg': cleanPublicText(footer.bgColor).trim() || articleFooterBackgroundFallback,
    '--footer-color': cleanPublicText(footer.textColor).trim() || articleFooterTextFallback,
    '--footer-bg-image': image,
    '--footer-bg-repeat': bgMode === 'repeat' ? 'repeat' : 'no-repeat',
    '--footer-bg-size': bgMode === 'cover' ? 'cover' : bgMode === 'contain' ? 'contain' : 'auto',
    '--footer-bg-pos': bgMode === 'repeat' ? '0 0' : 'center',
    '--footer-bg-overlay': cleanPublicText(footer.bgOverlay, '0'),
    '--footer-cols': String(columns.length || 4),
  } as CSSProperties;
  const renderImage = (title: string, id: unknown, key: string) => (
    <section key={key} className="reader-footer-column reader-footer-qr">
      <h2>{title}</h2>
      {safePublicImageID(id) ? (
        <img src={`${backendBase}/public/site/files/${Number(id)}`} alt={title} width="150" height="150" loading="lazy" />
      ) : (
        <div className="reader-footer-placeholder" aria-label={t.public.imageNotSet(title)}>
          {readerIcon('image')}
        </div>
      )}
    </section>
  );
  const renderLink = (value: unknown, className: string, key: string): ReactNode => {
    if (!isPublicRecord(value)) return null;
    const label = cleanPublicText(value.label);
    const rawURL = cleanPublicText(value.url);
    let href = '';
    try {
      const url = new URL(rawURL);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) href = url.href;
    } catch {
      /* Invalid public links render as inert labels. */
    }
    return href ? (
      <a key={key} className={className} href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    ) : (
      <span key={key} className={className}>
        {label}
      </span>
    );
  };
  const renderColumn = (column: Record<string, unknown>, index: number) => {
    const title = cleanPublicText(column.title);
    const type = cleanPublicText(column.type, 'links');
    if (type === 'image') return renderImage(title, column.image, String(index));
    const links = Array.isArray(column.links) ? column.links : [];
    if (type === 'contact')
      return (
        <section key={index} className="reader-footer-column">
          <h2>{title}</h2>
          <ul className="list-unstyled contact">
            {links.map((link, linkIndex) => (
              <li key={linkIndex}>{renderLink(link, 'label label-transparent', `${index}-${linkIndex}`)}</li>
            ))}
            {!links.length ? <li className="reader-footer-empty">{t.public.noContacts}</li> : null}
          </ul>
        </section>
      );
    if (type === 'text')
      return (
        <section key={index} className="reader-footer-column reader-footer-text-col">
          <h2>{title}</h2>
          <div className="reader-footer-text">{cleanPublicText(column.text)}</div>
        </section>
      );
    if (type === 'keyvalue') {
      const items = Array.isArray(column.items)
        ? column.items.filter(isPublicRecord).filter((item) => cleanPublicText(item.key).trim())
        : [];
      return (
        <section key={index} className="reader-footer-column reader-footer-kv-col">
          <h2>{title}</h2>
          <div className="reader-footer-kv-wrap">
            {items.length ? (
              <dl className="reader-footer-kv-list">
                {items.map((item, itemIndex) => (
                  <div key={itemIndex} className="reader-footer-kv-row">
                    <dt className="reader-footer-kv-key">{cleanPublicText(item.key)}</dt>
                    <dd className="reader-footer-kv-val">{cleanPublicText(item.value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="reader-footer-empty">{t.public.noInfo}</span>
            )}
          </div>
        </section>
      );
    }
    return (
      <section key={index} className="reader-footer-column">
        <h2>{title}</h2>
        <div className="friend-link">
          {links.map((link, linkIndex) =>
            renderLink(link, `label label-${labelColors[linkIndex % labelColors.length]}`, `${index}-${linkIndex}`),
          )}
          {!links.length ? <span className="reader-footer-empty">{t.public.noLinks}</span> : null}
        </div>
      </section>
    );
  };
  const legacyColumns = columns.length
    ? columns
    : [
        { type: 'image', title: cleanPublicText(footer.subscriptionTitle), image: footer.subscriptionImage },
        { type: 'contact', title: cleanPublicText(footer.contactTitle), links: footer.contacts },
        { type: 'links', title: cleanPublicText(footer.friendsTitle), links: footer.friends },
        { type: 'image', title: cleanPublicText(footer.qrCodeTitle), image: footer.qrCodeImage },
      ];
  const recordLink = { label: cleanPublicText(footer.recordLabel), url: cleanPublicText(footer.recordUrl) };
  const footerRows = groupArticleFooterItems(readArticleFooterItems(footer.items));
  return (
    <footer
      className="reader-footer"
      aria-label={t.public.footerAria}
      data-border={cleanPublicText(footer.borderStyle, 'solid')}
      data-align={cleanPublicText(footer.align, 'center')}
      style={style}
    >
      <div className="container">
        <div className="reader-footer-grid">{legacyColumns.map(renderColumn)}</div>
        {footerRows.length > 0 && (
          <div className="reader-footer-items">
            {footerRows.map((row, rowIndex) => (
              <div className="reader-footer-item-row" key={`footer-row-${rowIndex}`}>
                {row.map((item, itemIndex) => (
                  <Fragment key={`footer-item-${rowIndex}-${itemIndex}`}>
                    {itemIndex > 0 && (
                      <span className="reader-footer-item-separator" aria-hidden="true">
                        |
                      </span>
                    )}
                    {renderLink({ label: item.text, url: item.url }, 'reader-footer-item', `${rowIndex}-${itemIndex}`)}
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        )}
        {footerRows.length === 0 && (
          <div className="reader-footer-bottom">
            <span className="reader-footer-copy">{cleanPublicText(footer.copyright)}</span>
            {recordLink.label ? renderLink(recordLink, 'reader-footer-record', 'record') : null}
          </div>
        )}
      </div>
    </footer>
  );
}

export default PublicArticleFooter;
