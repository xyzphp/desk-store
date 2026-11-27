import { useCallback, useMemo } from 'react';
import { FormAIEditor } from '../../shared/ai/FormAIEditor';
import type { useArticles } from './useArticles';
import type { ArticleTaxonomy } from './api';
import { applyArticleFormAI, articleFormAIFields, articleFormAIOptions } from './articleFormAIModel';

type ArticleState = ReturnType<typeof useArticles>;
const EMPTY_TAXONOMIES: readonly ArticleTaxonomy[] = [];

export function ArticleFormAI({ state }: { state: ArticleState }) {
  const draft = state.draft;
  const taxonomies = state.catalog?.taxonomies ?? EMPTY_TAXONOMIES;
  const { setDraft, allowed, busy, record } = state;
  const fields = useMemo(() => (draft ? articleFormAIFields(draft, taxonomies) : {}), [draft, taxonomies]);
  const referenceOptions = useMemo(() => articleFormAIOptions(taxonomies), [taxonomies]);
  const canEdit = useCallback(
    () => allowed && !!draft && !busy && !record?.trashedAt,
    [draft, allowed, busy, record?.trashedAt],
  );
  const onApply = useCallback(
    (changes: Record<string, string>) => {
      if (!draft || !canEdit()) return false;
      const next = applyArticleFormAI(draft, taxonomies, changes);
      if (!next) return false;
      setDraft(next);
      return true;
    },
    [canEdit, draft, setDraft, taxonomies],
  );
  if (!draft || record?.trashedAt) return null;
  return (
    <FormAIEditor
      active={allowed && !busy}
      target="article.form"
      identity={{ recordId: record?.id ?? 0, revision: record?.revision ?? 0 }}
      fields={fields}
      referenceOptions={referenceOptions}
      permission="article-management"
      canEdit={canEdit}
      onApply={onApply}
    />
  );
}
