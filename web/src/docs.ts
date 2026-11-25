// 文档来自仓库 docs/ 下的 Markdown，构建时打包进网站。文件名的数字前缀决定顺序，
// 去掉前缀后作为页面标识；文档之间的相对 .md 链接改写为站内 hash 路由。

const sources = import.meta.glob('../../docs/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface DocPage {
  section: string;
  id: string;
  title: string;
  body: string;
}

export interface DocSection {
  id: string;
  title: string;
  pages: DocPage[];
}

const sectionTitles: Record<string, string> = {
  site: '使用商店',
  develop: '应用开发',
  'self-host': '自建商店',
};

const sectionOrder = ['site', 'develop', 'self-host'];

function pageId(file: string) {
  return file.replace(/\.md$/, '').replace(/^\d+-/, '');
}

function rewriteLinks(markdown: string, section: string) {
  return markdown.replace(/\]\((\.\.?\/)?(?:([\w-]+)\/)?(\d+-)?([\w-]+)\.md(#[\w-]+)?\)/g, (_match, relative, folder, _prefix, name) => {
    const target = relative === '../' && folder ? folder : section;
    return `](#/docs/${target}/${name})`;
  });
}

function build(): DocSection[] {
  const sections = new Map<string, DocPage[]>();
  for (const [path, raw] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
    const [, section = '', file = ''] = path.match(/docs\/([^/]+)\/([^/]+)$/) ?? [];
    if (!sectionTitles[section]) continue;
    const text = raw.replace(/\r\n/g, '\n').trim();
    const heading = text.match(/^#\s+(.+)$/m);
    const body = heading ? text.replace(heading[0], '').trim() : text;
    const pages = sections.get(section) ?? [];
    pages.push({ section, id: pageId(file), title: heading?.[1]?.trim() ?? pageId(file), body: rewriteLinks(body, section) });
    sections.set(section, pages);
  }
  return sectionOrder.filter((id) => sections.has(id)).map((id) => ({ id, title: sectionTitles[id]!, pages: sections.get(id)! }));
}

export const docSections = build();

export function findDoc(section?: string, page?: string): DocPage | undefined {
  const group = docSections.find((item) => item.id === section) ?? docSections[0];
  if (!group) return undefined;
  return group.pages.find((item) => item.id === page) ?? group.pages[0];
}
