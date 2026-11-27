import type { ArticleFooterItem } from './api';

export const articleFooterItemLimit = 16;

export function readArticleFooterItems(value: unknown): ArticleFooterItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    return [
      {
        text: typeof raw.text === 'string' ? raw.text : '',
        url: typeof raw.url === 'string' ? raw.url : '',
        newline: raw.newline === true,
      },
    ];
  });
}

export function groupArticleFooterItems(items: readonly ArticleFooterItem[]): ArticleFooterItem[][] {
  const rows: ArticleFooterItem[][] = [];
  let row: ArticleFooterItem[] = [];
  for (const item of items) {
    if (!item.text.trim()) continue;
    row.push(item);
    if (item.newline) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  return rows;
}
