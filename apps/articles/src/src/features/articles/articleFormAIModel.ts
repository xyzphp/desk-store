import type { ArticleDraft, ArticleTaxonomy } from './api';
import { categoryPath } from './model';
import { articleText, type ArticleMessages } from './locale';

export function articleFormAIFields(
  draft: ArticleDraft,
  taxonomies: readonly ArticleTaxonomy[],
  t: ArticleMessages = articleText(),
) {
  const selectedTags = draft.tagIds
    .map((id) => taxonomies.find((item) => item.kind === 'tag' && item.id === id)?.name ?? '')
    .filter(Boolean);
  return {
    title: draft.title,
    summary: draft.summary,
    content: draft.content,
    category:
      categoryPath(
        taxonomies.find((item) => item.kind === 'category' && item.id === draft.categoryId),
        taxonomies,
      ) || t.common.uncategorized,
    tags: selectedTags.join('\n'),
    visibility: draft.visibility === 'public' ? t.common.visibility.public : t.common.visibility.private,
  };
}

function unique(values: readonly string[]) {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].filter(([, count]) => count === 1).map(([value]) => value);
}

export function articleFormAIOptions(taxonomies: readonly ArticleTaxonomy[], t: ArticleMessages = articleText()) {
  const categories = unique(
    taxonomies.filter((item) => item.kind === 'category').map((item) => categoryPath(item, taxonomies)),
  );
  const tags = unique(taxonomies.filter((item) => item.kind === 'tag').map((item) => item.name));
  return {
    category: [t.common.uncategorized, ...categories.filter((value) => value !== t.common.uncategorized)],
    tags,
    visibility: [t.common.visibility.private, t.common.visibility.public],
  };
}

export function applyArticleFormAI(
  draft: ArticleDraft,
  taxonomies: readonly ArticleTaxonomy[],
  changes: Readonly<Record<string, string>>,
  t: ArticleMessages = articleText(),
): ArticleDraft | undefined {
  const next = { ...draft, tagIds: [...draft.tagIds] };
  if (Object.hasOwn(changes, 'title')) {
    if (typeof changes.title !== 'string') return undefined;
    const title = changes.title.trim();
    if (title.length > 160) return undefined;
    next.title = title;
  }
  if (Object.hasOwn(changes, 'summary')) {
    if (typeof changes.summary !== 'string') return undefined;
    const summary = changes.summary.trim();
    if (summary.length > 500) return undefined;
    next.summary = summary;
  }
  if (Object.hasOwn(changes, 'content')) {
    if (typeof changes.content !== 'string') return undefined;
    if (changes.content.length > 80_000) return undefined;
    next.content = changes.content;
  }
  if (Object.hasOwn(changes, 'category')) {
    if (typeof changes.category !== 'string') return undefined;
    const categoryIds = new Map<string, number | null>([[t.common.uncategorized, 0]]);
    for (const item of taxonomies.filter((entry) => entry.kind === 'category')) {
      const name = categoryPath(item, taxonomies);
      if (name && !categoryIds.has(name)) categoryIds.set(name, item.id);
      else if (name) categoryIds.set(name, null);
    }
    const categoryId = categoryIds.get(changes.category);
    if (categoryId === undefined || categoryId === null) return undefined;
    next.categoryId = categoryId;
  }
  if (Object.hasOwn(changes, 'tags')) {
    if (typeof changes.tags !== 'string') return undefined;
    const tagIDs = new Map<string, number | null>();
    for (const item of taxonomies.filter((entry) => entry.kind === 'tag')) {
      if (!tagIDs.has(item.name)) tagIDs.set(item.name, item.id);
      else tagIDs.set(item.name, null);
    }
    const names = changes.tags.split('\n');
    if (
      !names.length ||
      names.length > 12 ||
      new Set(names).size !== names.length ||
      names.some((name) => tagIDs.get(name) === undefined || tagIDs.get(name) === null)
    )
      return undefined;
    next.tagIds = names.map((name) => tagIDs.get(name) as number);
  }
  if (Object.hasOwn(changes, 'visibility')) {
    if (typeof changes.visibility !== 'string') return undefined;
    if (![t.common.visibility.private, t.common.visibility.public].includes(changes.visibility)) return undefined;
    next.visibility = changes.visibility === t.common.visibility.public ? 'public' : 'private';
  }
  return next;
}
