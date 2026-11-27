import type { ArticleDraft, ArticleSummary, ArticleTaxonomy, ArticleView } from './api';

export interface ArticleCategoryNode extends ArticleTaxonomy {
  children: ArticleCategoryNode[];
}

export function categoryAndDescendantIDs(categoryId: number, taxonomies: readonly ArticleTaxonomy[]) {
  const ids = new Set<number>();
  const addChildren = (parentId: number) => {
    for (const item of taxonomies) {
      if (item.kind === 'category' && item.parentId === parentId && !ids.has(item.id)) {
        ids.add(item.id);
        addChildren(item.id);
      }
    }
  };
  if (categoryId) {
    ids.add(categoryId);
    addChildren(categoryId);
  }
  return ids;
}

export function categoryPath(item: ArticleTaxonomy | undefined, taxonomies: readonly ArticleTaxonomy[]) {
  if (!item) return '';
  const parts = [item.name];
  const visited = new Set([item.id]);
  let current = item;
  while (current.parentId) {
    const parent = taxonomies.find((entry) => entry.id === current.parentId && entry.kind === 'category');
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    parts.unshift(parent.name);
    current = parent;
  }
  return parts.join(' / ');
}

export function categoryDepth(item: ArticleTaxonomy | undefined, taxonomies: readonly ArticleTaxonomy[]) {
  if (!item) return 0;
  let depth = 1;
  let current = item;
  const visited = new Set([item.id]);
  while (current.parentId) {
    const parent = taxonomies.find((entry) => entry.id === current.parentId && entry.kind === 'category');
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    current = parent;
    depth++;
  }
  return depth;
}

export function categoryAncestorIDs(categoryId: number, taxonomies: readonly ArticleTaxonomy[]) {
  const result: number[] = [];
  let current = taxonomies.find((item) => item.id === categoryId && item.kind === 'category');
  const visited = new Set<number>();
  while (current?.parentId) {
    const parent = taxonomies.find((item) => item.id === current?.parentId && item.kind === 'category');
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    result.unshift(parent.id);
    current = parent;
  }
  return result;
}

export function buildCategoryTree(taxonomies: readonly ArticleTaxonomy[]): ArticleCategoryNode[] {
  const nodes = new Map<number, ArticleCategoryNode>();
  for (const item of taxonomies) if (item.kind === 'category') nodes.set(item.id, { ...item, children: [] });
  const roots: ArticleCategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.parentId);
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: ArticleCategoryNode[]) => {
    items.sort((left, right) => left.id - right.id);
    items.forEach((item) => sort(item.children));
  };
  sort(roots);
  return roots;
}

export function visibleArticles(
  items: readonly ArticleSummary[],
  filter: { view: ArticleView; category: number; tag: number; query: string },
  taxonomies: readonly ArticleTaxonomy[],
) {
  const categoryIDs = filter.category ? categoryAndDescendantIDs(filter.category, taxonomies) : undefined;
  const query = filter.query.toLocaleLowerCase();
  return items.filter((item) => {
    if (filter.view === 'trash' ? !item.trashedAt : !!item.trashedAt) return false;
    if (filter.view === 'draft' && item.publishedAt && !item.changed) return false;
    if (filter.view === 'public' && (!item.publishedAt || item.visibility !== 'public')) return false;
    if (filter.view === 'private' && (!item.publishedAt || item.visibility !== 'private')) return false;
    if (filter.category && !categoryIDs?.has(item.categoryId)) return false;
    if (filter.tag && !item.tagIds.includes(filter.tag)) return false;
    return !query || `${item.title}\n${item.summary}`.toLocaleLowerCase().includes(query);
  });
}

export function visibleAttachmentFileIDs(draft: ArticleDraft) {
  const embedded = new Set(
    [
      ...draft.content.matchAll(
        /!?(?:\[[^\]\r\n]+\])\(article-file:([1-9]\d*)(?:[ \t]+"[^"\r\n]*")?(?:[ \t]+=[0-9]{2,4})?(?:[ \t]+row=[1-4])?\)/g,
      ),
    ].map((match) => Number(match[1])),
  );
  return draft.fileIds.filter((id) => id !== draft.coverFileId && !embedded.has(id));
}
