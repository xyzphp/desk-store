import { Icon, useMessages } from '@xyzos/desk-ui';
import type { ArticleFooterItem } from './api';
import { articleFooterItemLimit } from './footerItems';
import { articleMessages } from './locale';

export function ArticleFooterItemsEditor({
  items,
  onChange,
}: {
  items: ArticleFooterItem[];
  onChange: (items: ArticleFooterItem[]) => void;
}) {
  const t = useMessages(articleMessages);
  const updateItem = (index: number, patch: Partial<ArticleFooterItem>) =>
    onChange(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));

  return (
    <section className="ar-site-settings-group ar-footer-items-group">
      <header>
        <h3>
          <Icon className="xyz-icon lucide" name="list" />
          {t.site.footerItemsTitle}
        </h3>
      </header>
      <p className="ar-footer-items-hint">{t.site.footerItemsHint}</p>
      <div className="ar-footer-items-list">
        {items.map((item, index) => (
          <div className="ar-site-footer-item-row" key={`footer-item-${index}`}>
            <span className="ar-footer-item-index" aria-hidden="true">
              {index + 1}
            </span>
            <input
              maxLength={240}
              value={item.text}
              placeholder={t.site.footerItemTextPlaceholder}
              aria-label={t.site.footerItemTextAria(index + 1)}
              onChange={(event) => updateItem(index, { text: event.currentTarget.value })}
            />
            <input
              type="url"
              maxLength={500}
              value={item.url}
              placeholder={t.site.footerItemUrlPlaceholder}
              aria-label={t.site.footerItemUrlAria(index + 1)}
              onChange={(event) => updateItem(index, { url: event.currentTarget.value })}
            />
            <label className="ar-footer-item-newline">
              <input
                type="checkbox"
                checked={item.newline}
                aria-label={t.site.footerItemNewlineAria(index + 1)}
                onChange={(event) => updateItem(index, { newline: event.currentTarget.checked })}
              />
              <span>{t.site.footerNewline}</span>
            </label>
            <div className="ar-site-col-tools">
              <button
                type="button"
                title={t.site.moveUp}
                aria-label={t.site.footerItemMoveUpAria(index + 1)}
                disabled={index === 0}
                onClick={() => {
                  const next = [...items];
                  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                  onChange(next);
                }}
              >
                <Icon className="xyz-icon lucide" name="arrow-up" />
              </button>
              <button
                type="button"
                title={t.site.moveDown}
                aria-label={t.site.footerItemMoveDownAria(index + 1)}
                disabled={index === items.length - 1}
                onClick={() => {
                  const next = [...items];
                  [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                  onChange(next);
                }}
              >
                <Icon className="xyz-icon lucide" name="arrow-down" />
              </button>
              <button
                type="button"
                className="ar-danger"
                title={t.site.deleteFooterItem}
                aria-label={t.site.deleteFooterItemAria(index + 1)}
                onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
              >
                <Icon className="xyz-icon lucide" name="trash-2" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="ar-button"
        disabled={items.length >= articleFooterItemLimit}
        onClick={() => onChange([...items, { text: '', url: '', newline: false }])}
      >
        <Icon className="xyz-icon lucide" name="plus" />
        {t.site.footerItemAdd(items.length, articleFooterItemLimit)}
      </button>
    </section>
  );
}
