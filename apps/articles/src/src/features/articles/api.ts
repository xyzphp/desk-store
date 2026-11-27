import type { RequestOptions } from '../../host/types';

export type ArticleView = 'all' | 'draft' | 'private' | 'public' | 'trash';
export type ArticleVisibility = 'private' | 'public';
export type TaxonomyKind = 'category' | 'tag';

export interface ArticleDraft {
  title: string;
  summary: string;
  content: string;
  visibility: ArticleVisibility;
  categoryId: number;
  coverFileId: number;
  coverWidth: number;
  coverHeight: number;
  tagIds: number[];
  fileIds: number[];
}

export interface ArticleSummary {
  id: number;
  title: string;
  summary: string;
  categoryId: number;
  tagIds: number[];
  coverFileId: number;
  coverWidth: number;
  coverHeight: number;
  visibility: ArticleVisibility;
  draftVisibility: ArticleVisibility;
  revision: number;
  publishedAt: number;
  trashedAt: number;
  updatedAt: number;
  changed: boolean;
}

export interface ArticleRecord {
  id: number;
  draft: ArticleDraft;
  published?: ArticleDraft;
  visibility: ArticleVisibility;
  revision: number;
  publishedAt: number;
  trashedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface ArticleTaxonomy {
  id: number;
  kind: TaxonomyKind;
  name: string;
  parentId: number;
  revision: number;
}

export interface ArticleFile {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  parentId: number;
  providerId: number;
  mediaType: string;
  size: number;
  width?: number;
  height?: number;
  isPublic: boolean;
  trashedAt: number;
  legacy?: boolean;
}

export interface ArticleCatalog {
  items: ArticleSummary[];
  taxonomies: ArticleTaxonomy[];
  publicBase: string;
}

export interface ArticleDetail {
  article: ArticleRecord;
  files: ArticleFile[];
}

export interface ArticleWorkspace {
  view: ArticleView;
  query: string;
  category: number;
  tag: number;
  articleId: number;
  draft?: ArticleDraft;
  revision?: number;
  layout: 'card' | 'list';
  libraryCollapsed: boolean;
  sidebarWidth?: number;
  libraryWidth?: number;
  categoriesCollapsed?: boolean;
  tagsCollapsed?: boolean;
  collapsedCategoryIds?: number[];
  editorMode?: 'edit' | 'split' | 'preview';
}

export interface ArticleQuote {
  day: string;
  text: string;
  status: 'ready' | 'failed' | 'pending';
  source: 'manual' | 'api';
  revision: number;
  failure?: { message?: string };
}

export interface ArticleSiteConfig {
  name: string;
  title: string;
  description: string;
  logoImage: number;
  avatarImage: number;
  quote: { mode: 'none' | 'manual' | 'api'; url: string; format: string; field: string };
  banners: {
    enabled: boolean;
    avatarEnabled: boolean;
    home: number;
    detail: number;
    archives: number;
    categories: number;
    tags: number;
    homeEnabled: boolean;
    detailEnabled: boolean;
    archivesEnabled: boolean;
    categoriesEnabled: boolean;
    tagsEnabled: boolean;
  };
  footer: {
    enabled: boolean;
    columns: Array<{
      enabled: boolean;
      type: 'links' | 'text' | 'image' | 'keyvalue';
      title: string;
      image?: number;
      text?: string;
      links?: Array<{ label: string; url: string }>;
      items?: Array<{ key: string; value: string }>;
    }>;
    items: ArticleFooterItem[];
    bgColor: string;
    textColor: string;
    bgImage: number;
    bgImageUrl: string;
    bgMode: 'repeat' | 'cover' | 'contain' | 'center' | 'none';
    bgOverlay: string;
    borderStyle: 'solid' | 'gradient' | 'dashed' | 'none';
    align: 'center' | 'split';
    showPoweredBy: boolean;
    copyright: string;
    recordLabel: string;
    recordUrl: string;
  };
}

export interface ArticleFooterItem {
  text: string;
  url: string;
  newline: boolean;
}

export interface ArticleSite {
  config: ArticleSiteConfig;
  revision: number;
  updatedAt: number;
}

export type ArticleRequest = <T>(path: string, options?: RequestOptions) => Promise<T>;

export const articlePath = 'articles';
export const articleSitePath = 'articles/site';
export const articleTaxonomiesPath = 'articles/taxonomies';
export const articleFilesPath = 'articles/files';

export function emptyArticleDraft(): ArticleDraft {
  return {
    title: '',
    summary: '',
    content: '',
    visibility: 'private',
    categoryId: 0,
    coverFileId: 0,
    coverWidth: 0,
    coverHeight: 0,
    tagIds: [],
    fileIds: [],
  };
}

export function articleDraftKey(draft: ArticleDraft) {
  return JSON.stringify({
    ...draft,
    coverFileId: draft.coverFileId || 0,
    tagIds: [...draft.tagIds].sort((left, right) => left - right),
    fileIds: [...draft.fileIds].sort((left, right) => left - right),
  });
}

export function articleFileId(file: Pick<ArticleFile, 'id'>) {
  const raw = /^(?:file|folder):([1-9]\d*)$/.exec(file.id)?.[1];
  const id = raw ? Number(raw) : 0;
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function articleFileURL(id: number) {
  return `/files/content/${id}`;
}

export function articleMediaMap(files: readonly ArticleFile[]) {
  return Object.fromEntries(
    files.flatMap((file) => {
      const id = articleFileId(file);
      if (!id) return [];
      return [
        [
          `article-file:${id}`,
          { url: `/files/content/${id}`, image: file.mediaType.startsWith('image/') },
        ],
      ];
    }),
  );
}
