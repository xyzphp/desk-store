import { useCallback, useEffect, useState } from 'react';
import { Icon, useMessages } from '@xyzos/desk-ui';
import type { ArticleQuote } from './api';
import type { useArticles } from './useArticles';
import { articleMessages, articleText } from './locale';

type ArticleState = ReturnType<typeof useArticles>;

interface QuoteResponse {
  items: ArticleQuote[];
  more: boolean;
  today: string;
  currentRevision: number;
}

function isQuoteResponse(value: unknown): value is QuoteResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    'items' in value &&
    Array.isArray(value.items) &&
    'today' in value &&
    typeof value.today === 'string' &&
    'currentRevision' in value
  );
}

export function ArticleSiteQuotes({
  state,
  edits,
  setEdits,
  configDirty,
  saveConfig,
}: {
  state: ArticleState;
  edits: Record<string, string>;
  setEdits: (next: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) => void;
  configDirty: boolean;
  saveConfig: () => Promise<boolean>;
}) {
  const t = useMessages(articleMessages);
  const { request, setError, setStatus } = state;
  const [items, setItems] = useState<ArticleQuote[]>([]);
  const [today, setToday] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      try {
        const suffix = before ? `?before=${encodeURIComponent(before)}` : '';
        const response = await request(`/site/quotes${suffix}`, {
          fallbackError: articleText().site.quotes.loadFailed,
        });
        if (!isQuoteResponse(response)) throw new Error(articleText().site.quotes.formatError);
        setItems((current) => (before ? [...current, ...response.items] : response.items));
        setToday(response.today);
        setRevision(response.currentRevision);
        setMore(response.more);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : articleText().site.quotes.loadFailed);
      }
    },
    [request, setError],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: 'fetch' | 'edit', item?: ArticleQuote) => {
    if (busy) return;
    if (action === 'fetch' && Object.keys(edits).length) {
      setError(articleText().site.quotes.saveFirst);
      return;
    }
    if (action === 'fetch' && configDirty && !(await saveConfig())) return;
    const day = action === 'fetch' ? today : (item?.day ?? '');
    const text = action === 'edit' && item ? (edits[item.day] ?? item.text).trim() : '';
    if (!day || (action === 'edit' && !text)) return;
    setBusy(true);
    try {
      const response = await request('/site/quotes', {
        method: 'POST',
        body: { action, day, text, revision: action === 'fetch' ? revision : (item?.revision ?? 0) },
        fallbackError:
          action === 'fetch' ? articleText().site.quotes.fetchFailed : articleText().site.quotes.saveFailed,
      });
      if (!response || typeof response !== 'object' || !('item' in response))
        throw new Error(articleText().site.quotes.actionFormatError);
      const saved = response.item as ArticleQuote;
      setItems((current) => [saved, ...current.filter((entry) => entry.day !== saved.day)]);
      setEdits((current) => {
        const next = { ...current };
        delete next[saved.day];
        return next;
      });
      if (saved.day === today) setRevision(saved.revision);
      const failed = 'failure' in response && !!response.failure;
      setStatus(
        failed
          ? articleText().site.quotes.apiFailedNotice
          : action === 'fetch'
            ? articleText().site.quotes.fetched
            : articleText().site.quotes.updated,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : articleText().site.quotes.actionFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ar-quote-history-panel" data-ar-quote-history-panel>
      <div className="ar-quote-history-bar">
        <div className="ar-quote-history-title">
          <h4>
            <Icon className="xyz-icon lucide" name="quote" />
            {t.site.quotes.title}
          </h4>
          <span className="ar-quote-history-count">{t.site.quotes.subtitle}</span>
        </div>
        <button type="button" data-ar-quote-fetch disabled={busy || !today} onClick={() => void act('fetch')}>
          <Icon className="xyz-icon lucide" name="refresh-cw" />
          {t.site.quotes.fetchToday}
        </button>
      </div>
      <div className="ar-quote-table-wrap">
        <div className="ar-quote-table-scroll">
          <table className="ar-quote-table">
            <thead>
              <tr>
                <th className="ar-th-day">{t.site.quotes.thDay}</th>
                <th className="ar-th-status">{t.site.quotes.thStatus}</th>
                <th className="ar-th-text">{t.site.quotes.thText}</th>
                <th className="ar-th-action">{t.site.quotes.thAction}</th>
              </tr>
            </thead>
            <tbody data-ar-quote-list>
              {items.length ? (
                items.map((item) => (
                  <tr
                    className={`ar-quote-row${item.day === today ? ' is-today' : ''}${edits[item.day] !== undefined ? ' is-modified' : ''}`}
                    key={item.day}
                  >
                    <td className="ar-td-day">
                      <span className="ar-quote-day-text">{item.day}</span>
                      {item.day === today && <span className="ar-quote-today-badge">{t.site.quotes.todayBadge}</span>}
                    </td>
                    <td className="ar-td-status">
                      <span
                        className={`ar-quote-status-badge is-${item.status === 'ready' ? item.source : item.status}`}
                      >
                        {item.status === 'ready'
                          ? item.source === 'manual'
                            ? t.site.quotes.statusManual
                            : t.site.quotes.statusAuto
                          : item.status === 'failed'
                            ? t.site.quotes.statusFailed
                            : t.site.quotes.statusFetching}
                      </span>
                    </td>
                    <td className="ar-td-text">
                      <div className="ar-quote-input-wrap">
                        <input
                          className="ar-quote-table-input"
                          data-ar-quote-text={item.day}
                          maxLength={240}
                          aria-label={t.site.quotes.dayAria(item.day)}
                          value={edits[item.day] ?? item.text}
                          onChange={(event) =>
                            setEdits((current) => ({ ...current, [item.day]: event.currentTarget.value }))
                          }
                        />
                        <span className="ar-quote-char-count">{(edits[item.day] ?? item.text).length}/240</span>
                      </div>
                    </td>
                    <td className="ar-td-action">
                      <button
                        type="button"
                        className={`ar-quote-save-btn${edits[item.day] !== undefined ? ' is-dirty' : ''}`}
                        data-ar-quote-edit={item.day}
                        disabled={busy || edits[item.day] === undefined}
                        onClick={() => void act('edit', item)}
                      >
                        {t.site.quotes.saveAction}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="ar-quote-table-empty">
                    {t.site.quotes.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {more && (
        <div className="ar-quote-more-wrap">
          <button type="button" data-ar-quote-more disabled={busy} onClick={() => void load(items.at(-1)?.day)}>
            {t.site.quotes.loadEarlier}
          </button>
        </div>
      )}
    </section>
  );
}
