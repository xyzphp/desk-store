import { MarkdownView } from '@xyzos/desk-ui';
import { docSections, findDoc } from '../docs';
import { href } from '../router';

export function Docs({ section, page }: { section?: string; page?: string }) {
  const doc = findDoc(section, page);
  return (
    <div className="store-section store-section--first store-docs">
      <nav className="store-docs-nav" aria-label="文档目录">
        {docSections.map((group) => (
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
        ))}
      </nav>
      <article className="store-docs-body">
        {doc ? (
          <>
            <h1>{doc.title}</h1>
            <MarkdownView className="store-markdown" value={doc.body} />
            <p className="store-docs-edit">
              <a
                href={`https://github.com/xyzphp/desk-store/tree/main/docs/${doc.section}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                在 GitHub 上改进这篇文档
              </a>
            </p>
          </>
        ) : (
          <p className="store-muted">没有找到文档。</p>
        )}
      </article>
    </div>
  );
}
