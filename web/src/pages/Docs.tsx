import { useEffect, useMemo, useState } from 'react';
import { Icon, SearchField } from '@xyzos/desk-ui';
import { DocMarkdown, parseDocContent } from '../components/DocMarkdown';
import { adjacentDocs, docSections, findDoc, findDocSection } from '../docs';
import { href } from '../router';

export function Docs({ section, page }: { section?: string; page?: string }) {
  const doc = findDoc(section, page);
  const currentGroup = doc ? findDocSection(doc.section) : undefined;
  const [filter, setFilter] = useState('');

  const { headings } = useMemo(
    () => (doc ? parseDocContent(doc.body) : { blocks: [], headings: [] }),
    [doc],
  );
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    setActiveId(headings[0]?.id ?? '');
    if (headings.length === 0) return;

    const updateActive = () => {
      let current = headings[0]?.id ?? '';
      for (const heading of headings) {
        const el = document.getElementById(heading.id);
        if (el && el.getBoundingClientRect().top <= 140) {
          current = heading.id;
        }
      }
      setActiveId(current);
    };

    window.addEventListener('scroll', updateActive, { passive: true });
    return () => window.removeEventListener('scroll', updateActive);
  }, [headings]);

  const keyword = filter.trim().toLowerCase();
  const visibleSections = useMemo(() => {
    if (!keyword) return docSections;
    return docSections
      .map((group) => ({
        ...group,
        pages: group.pages.filter(
          (item) =>
            item.title.toLowerCase().includes(keyword) ||
            group.title.toLowerCase().includes(keyword) ||
            item.body.toLowerCase().includes(keyword),
        ),
      }))
      .filter((group) => group.pages.length > 0);
  }, [keyword]);

  const { prev, next } = doc ? adjacentDocs(doc.section, doc.id) : {};

  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  };

  return (
    <div className="store-section store-section--first store-docs">
      <aside className="store-docs-nav" aria-label="文档目录">
        <div className="store-docs-search">
          <SearchField
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            placeholder="检索文档标题或内容"
            aria-label="检索文档"
          />
        </div>
        {visibleSections.length === 0 ? (
          <p className="store-muted store-small store-docs-no-match">没有匹配的文档。</p>
        ) : (
          visibleSections.map((group) => (
            <div key={group.id} className="store-docs-group">
              <h2>{group.title}</h2>
              <ul>
                {group.pages.map((item) => (
                  <li key={item.id}>
                    <a
                      href={href({ name: 'docs', section: group.id, page: item.id })}
                      aria-current={doc?.section === group.id && doc.id === item.id ? 'page' : undefined}
                    >
                      {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </aside>

      <article className="store-docs-body">
        {doc ? (
          <>
            <nav className="store-doc-crumb" aria-label="文档路径">
              <a href={href({ name: 'docs', section: 'site', page: 'overview' })}>文档</a>
              <span aria-hidden="true">›</span>
              <a href={href({ name: 'docs', section: doc.section })}>{doc.sectionTitle}</a>
              <span aria-hidden="true">›</span>
              <span>{doc.title}</span>
            </nav>
            {currentGroup && <p className="store-eyebrow">{currentGroup.eyebrow}</p>}
            <h1 className="store-doc-title">{doc.title}</h1>
            <DocMarkdown value={doc.body} />

            <div className="store-doc-end">
              <div className="store-doc-pager">
                {prev ? (
                  <a className="store-pager-card" href={href({ name: 'docs', section: prev.section, page: prev.id })}>
                    <span className="store-pager-label">上一篇</span>
                    <strong>{prev.title}</strong>
                  </a>
                ) : (
                  <span />
                )}
                {next ? (
                  <a
                    className="store-pager-card store-pager-card--next"
                    href={href({ name: 'docs', section: next.section, page: next.id })}
                  >
                    <span className="store-pager-label">下一篇</span>
                    <strong>{next.title}</strong>
                  </a>
                ) : (
                  <span />
                )}
              </div>
              <p className="store-docs-edit">
                <a
                  href={`https://github.com/xyzphp/desk-store/blob/main/docs/${doc.section}/${doc.file}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="external-link" size={14} />
                  <span>在 GitHub 上改进这篇文档</span>
                </a>
              </p>
            </div>
          </>
        ) : (
          <p className="store-muted">没有找到文档。</p>
        )}
      </article>

      {headings.length > 0 && (
        <aside className="store-docs-toc" aria-label="本页目录">
          <h2>本页目录</h2>
          <ul>
            {headings.map((item) => (
              <li key={item.id} className={item.level === 3 ? 'is-nested' : undefined}>
                <button
                  type="button"
                  className={activeId === item.id ? 'is-active' : undefined}
                  onClick={() => scrollToHeading(item.id)}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
