// 文档来自仓库 docs/ 下的 Markdown，构建时打包进网站。文件名的数字前缀决定顺序，
// 去掉前缀后作为页面标识；文档之间的相对 .md 链接改写为站内 hash 路由，规范草案链接指向仓库源码。

const sources = import.meta.glob('../../docs/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface DocPage {
  section: string;
  sectionTitle: string;
  id: string;
  file: string;
  title: string;
  body: string;
}

export interface DocSection {
  id: string;
  title: string;
  eyebrow: string;
  pages: DocPage[];
}

const sectionMeta: Record<string, { title: string; eyebrow: string }> = {
  site: { title: '使用商店', eyebrow: 'Store Guide' },
  develop: { title: '应用开发', eyebrow: 'Developer Guide' },
  platform: { title: '平台能力', eyebrow: 'Platform API' },
  'self-host': { title: '自建商店', eyebrow: 'Self-Hosting' },
};

const sectionOrder = ['site', 'develop', 'platform', 'self-host'] as const;

const repoDocsBase = 'https://github.com/xyzphp/desk-store/blob/main/docs/';

function pageId(file: string) {
  return file.replace(/\.md$/, '').replace(/^\d+-/, '');
}

function rewriteLinks(markdown: string, section: string) {
  return markdown.replace(
    /\]\((\.\.?\/)?(?:([\w-]+)\/)?(\d+-)?([\w-]+)\.md(#[^)]+)?\)/g,
    (_match, relative, folder, prefix, name, hash = '') => {
      const target = relative === '../' && folder ? folder : section;
      if (sectionMeta[target]) {
        return `](#/docs/${target}/${name})`;
      }
      if (folder) {
        return `](${repoDocsBase}${folder}/${prefix ?? ''}${name}.md${hash})`;
      }
      return `](${repoDocsBase}${target}/${prefix ?? ''}${name}.md${hash})`;
    },
  );
}

function build(): DocSection[] {
  const sections = new Map<string, DocPage[]>();
  for (const [path, raw] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
    const [, section = '', file = ''] = path.match(/docs\/([^/]+)\/([^/]+)$/) ?? [];
    const meta = sectionMeta[section];
    if (!meta) continue;
    const text = raw.replace(/\r\n/g, '\n').trim();
    const heading = text.match(/^#\s+(.+)$/m);
    const body = heading ? text.replace(heading[0], '').trim() : text;
    const pages = sections.get(section) ?? [];
    pages.push({
      section,
      sectionTitle: meta.title,
      id: pageId(file),
      file,
      title: heading?.[1]?.trim() ?? pageId(file),
      body: rewriteLinks(body, section),
    });
    sections.set(section, pages);
  }
  return sectionOrder
    .filter((id) => sections.has(id))
    .map((id) => ({
      id,
      title: sectionMeta[id]!.title,
      eyebrow: sectionMeta[id]!.eyebrow,
      pages: sections.get(id)!,
    }));
}

export const docSections = build();

export const allDocPages: DocPage[] = docSections.flatMap((section) => section.pages);

export function findDoc(section?: string, page?: string): DocPage | undefined {
  const group = docSections.find((item) => item.id === section) ?? docSections[0];
  if (!group) return undefined;
  return group.pages.find((item) => item.id === page) ?? group.pages[0];
}

export function findDocSection(section: string): DocSection | undefined {
  return docSections.find((item) => item.id === section);
}

export function adjacentDocs(section: string, id: string): { prev?: DocPage; next?: DocPage } {
  const index = allDocPages.findIndex((item) => item.section === section && item.id === id);
  if (index < 0) return {};
  return {
    prev: index > 0 ? allDocPages[index - 1] : undefined,
    next: index + 1 < allDocPages.length ? allDocPages[index + 1] : undefined,
  };
}
