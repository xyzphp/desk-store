import { articleText } from './locale';

export interface PublicArticleTaxonomy {
  id: number;
  kind: 'category' | 'tag';
  name: string;
  parentId: number;
  count: number;
}

export interface PublicArticleSummary {
  id: number;
  title: string;
  summary: string;
  publishedAt: number;
  author: string;
  categoryId: number;
  tagIds: number[];
  visibility: 'public' | 'private';
  coverFileId?: number;
  coverWidth?: number;
  coverHeight?: number;
}

export interface PublicArticleArchive {
  month: string;
  count: number;
}

export interface PublicArticleList {
  items: PublicArticleSummary[];
  taxonomies: PublicArticleTaxonomy[];
  archives: PublicArticleArchive[];
  total: number;
  page: number;
  more: boolean;
  privateAccess: boolean;
  viewerId: number;
}

export interface PublicArticleFile {
  id: string;
  name: string;
  size: number;
  mediaType: string;
}

export interface PublicArticleDetail {
  id: number;
  article: {
    title: string;
    summary: string;
    content: string;
    visibility: 'public' | 'private';
    categoryId: number;
    tagIds: number[];
    coverFileId: number;
  };
  author: string;
  publishedAt: number;
  taxonomies: PublicArticleTaxonomy[];
  files: PublicArticleFile[];
  coverWidth?: number;
  coverHeight?: number;
}

export type PublicArticleView = 'home' | 'archives' | 'categories' | 'tags';

export function publicArticleView(value: string | null): PublicArticleView {
  return ['archives', 'categories', 'tags'].includes(value ?? '') ? (value as PublicArticleView) : 'home';
}

export function safeBaseOrigin(): string {
  try {
    if (typeof document !== 'undefined' && document.baseURI) {
      const origin = new URL(document.baseURI).origin;
      if (origin && origin !== 'null') return origin;
    }
  } catch {
    /* ignore */
  }
  return 'https://articles.local';
}

export function publicArticleLocation(path: string, base: string, origin = safeBaseOrigin()) {
  const safeOrigin = origin && origin !== 'null' ? origin : 'https://articles.local';
  const target = new URL(path, `${safeOrigin}${base.endsWith('/') ? base : `${base}/`}`);
  const cleanBase = base.replace(/\/+$/, '');
  const pathname = target.pathname;
  if (cleanBase && pathname !== cleanBase && !pathname.startsWith(`${cleanBase}/`)) {
    throw new Error(articleText().public.invalidURL);
  }
  const suffix = (cleanBase ? pathname.slice(cleanBase.length) : pathname).replace(/^\/+|\/+$/g, '');
  const id = suffix && /^[1-9]\d*$/.test(suffix) ? Number(suffix) : 0;
  if (suffix && !id) throw new Error(articleText().public.invalidArticleURL);
  return { id, query: new URLSearchParams(target.search), hash: target.hash };
}

export function publicArticleURL(base: string, query: URLSearchParams, id = 0) {
  const cleanBase = base.replace(/\/+$/, '');
  const search = query.toString();
  return `${cleanBase}${id ? `/${id}` : ''}${search ? `?${search}` : ''}`;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const safeInteger = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && Number(value) >= min;
const safeText = (value: unknown, max = 2000): value is string =>
  typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

function readTaxonomies(value: unknown): PublicArticleTaxonomy[] {
  if (!Array.isArray(value)) throw new Error(articleText().public.taxonomiesFormatError);
  return value.flatMap((item) => {
    if (
      !record(item) ||
      !safeInteger(item.id, 1) ||
      (item.kind !== 'category' && item.kind !== 'tag') ||
      !safeText(item.name, 128) ||
      !safeInteger(item.parentId) ||
      !safeInteger(item.count)
    )
      return [];
    return [
      {
        id: Number(item.id),
        kind: item.kind,
        name: item.name,
        parentId: Number(item.parentId),
        count: Number(item.count),
      },
    ];
  });
}

export function restorePublicArticleList(value: unknown): PublicArticleList {
  if (!record(value) || value.ok !== true || !Array.isArray(value.items) || !Array.isArray(value.archives))
    throw new Error(articleText().public.listFormatError);
  if (
    !safeInteger(value.total) ||
    !safeInteger(value.page, 1) ||
    typeof value.more !== 'boolean' ||
    typeof value.privateAccess !== 'boolean' ||
    !safeInteger(value.viewerId)
  )
    throw new Error(articleText().public.listFormatError);
  const items = value.items.flatMap((item) => {
    if (
      !record(item) ||
      !safeInteger(item.id, 1) ||
      !safeText(item.title, 256) ||
      !safeText(item.summary, 4000) ||
      !safeInteger(item.publishedAt, 1) ||
      !safeText(item.author, 128) ||
      !safeInteger(item.categoryId) ||
      !Array.isArray(item.tagIds) ||
      !item.tagIds.every((id) => safeInteger(id, 1)) ||
      (item.visibility !== 'public' && item.visibility !== 'private') ||
      (item.coverFileId !== undefined && !safeInteger(item.coverFileId, 1)) ||
      (item.coverWidth !== undefined && !safeInteger(item.coverWidth, 1)) ||
      (item.coverHeight !== undefined && !safeInteger(item.coverHeight, 1))
    )
      return [];
    return [
      {
        id: Number(item.id),
        title: item.title,
        summary: item.summary,
        publishedAt: Number(item.publishedAt),
        author: item.author,
        categoryId: Number(item.categoryId),
        tagIds: item.tagIds as number[],
        visibility: item.visibility as PublicArticleSummary['visibility'],
        ...(item.coverFileId ? { coverFileId: Number(item.coverFileId) } : {}),
        ...(item.coverWidth ? { coverWidth: Number(item.coverWidth) } : {}),
        ...(item.coverHeight ? { coverHeight: Number(item.coverHeight) } : {}),
      },
    ];
  });
  const archives = value.archives.flatMap((item) =>
    record(item) &&
    typeof item.month === 'string' &&
    /^\d{4}-(?:0[1-9]|1[0-2])$/.test(item.month) &&
    safeInteger(item.count)
      ? [{ month: item.month, count: Number(item.count) }]
      : [],
  );
  return {
    items,
    taxonomies: readTaxonomies(value.taxonomies),
    archives,
    total: Number(value.total),
    page: Number(value.page),
    more: value.more,
    privateAccess: value.privateAccess,
    viewerId: Number(value.viewerId),
  };
}

export function restorePublicArticleDetail(value: unknown): PublicArticleDetail {
  if (!record(value) || value.ok !== true || !record(value.article))
    throw new Error(articleText().public.detailFormatError);
  const article = value.article;
  if (
    !safeInteger(value.id, 1) ||
    !safeText(article.title, 256) ||
    !safeText(article.summary, 4000) ||
    !safeText(article.content, 80_000) ||
    (article.visibility !== 'public' && article.visibility !== 'private') ||
    !safeInteger(article.categoryId) ||
    !Array.isArray(article.tagIds) ||
    !article.tagIds.every((id) => safeInteger(id, 1)) ||
    !safeInteger(article.coverFileId) ||
    !safeInteger(value.publishedAt, 1) ||
    !safeText(value.author, 128) ||
    !Array.isArray(value.files)
  )
    throw new Error(articleText().public.detailFormatError);
  const files = value.files.flatMap((file) =>
    record(file) &&
    typeof file.id === 'string' &&
    /^article-file:[1-9]\d*$/.test(file.id) &&
    safeText(file.name, 255) &&
    safeInteger(file.size) &&
    safeText(file.mediaType, 128)
      ? [{ id: file.id, name: file.name, size: Number(file.size), mediaType: file.mediaType }]
      : [],
  );
  return {
    id: Number(value.id),
    article: {
      title: article.title,
      summary: article.summary,
      content: article.content,
      visibility: article.visibility,
      categoryId: Number(article.categoryId),
      tagIds: article.tagIds as number[],
      coverFileId: Number(article.coverFileId),
    },
    author: value.author,
    publishedAt: Number(value.publishedAt),
    taxonomies: readTaxonomies(value.taxonomies),
    files,
    ...(safeInteger(value.coverWidth, 1) ? { coverWidth: Number(value.coverWidth) } : {}),
    ...(safeInteger(value.coverHeight, 1) ? { coverHeight: Number(value.coverHeight) } : {}),
  };
}
