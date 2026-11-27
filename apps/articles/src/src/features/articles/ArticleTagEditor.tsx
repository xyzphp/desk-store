import { useMemo, useState, type KeyboardEvent } from 'react';
import { Icon, useMessages } from '@xyzos/desk-ui';
import type { ArticleDraft, ArticleTaxonomy } from './api';
import { articleMessages } from './locale';

export function ArticleTagEditor({
  draft,
  taxonomies,
  disabled,
  onChange,
  onCreate,
}: {
  draft: ArticleDraft;
  taxonomies: readonly ArticleTaxonomy[];
  disabled: boolean;
  onChange: (tagIds: number[]) => void;
  onCreate?: (name: string) => Promise<void>;
}) {
  const t = useMessages(articleMessages);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const tags = taxonomies.filter((item) => item.kind === 'tag');
  const selected = tags.filter((item) => draft.tagIds.includes(item.id));
  const suggestions = useMemo(
    () =>
      tags.filter(
        (item) =>
          !draft.tagIds.includes(item.id) && item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    [draft.tagIds, query, tags],
  );
  const choose = (id: number) => {
    onChange([...new Set([...draft.tagIds, id])]);
    setQuery('');
    setOpen(false);
  };
  const onKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (suggestions[0]) choose(suggestions[0].id);
    else if (onCreate && query.trim() && selected.length + 1 <= 12) {
      const name = query.trim().replace(/^#+/, '').slice(0, 40);
      if (name) {
        await onCreate(name);
        setQuery('');
        setOpen(false);
      }
    }
  };
  return (
    <div className="ar-tag-editor" data-ar-tag-editor>
      <div className="ar-tag-chips">
        {selected.map((item) => (
          <span className="ar-tag-chip" key={item.id}>
            <span>{item.name}</span>
            <button
              type="button"
              aria-label={t.tagEditor.removeTag(item.name)}
              disabled={disabled}
              onClick={() => onChange(draft.tagIds.filter((id) => id !== item.id))}
            >
              <Icon className="xyz-icon lucide" name="x" />
            </button>
          </span>
        ))}
      </div>
      <div className="ar-tag-input-wrap">
        <input
          className="ar-tag-input"
          data-ar-tag-input
          type="text"
          value={query}
          maxLength={40}
          placeholder={t.tagEditor.placeholder}
          aria-label={t.tagEditor.inputAria}
          aria-expanded={open}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 100)}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setOpen(true);
          }}
        />
        {open && suggestions.length > 0 && (
          <div className="ar-tag-suggestions" role="listbox" aria-label={t.tagEditor.suggestionsAria}>
            {suggestions.slice(0, 8).map((item) => (
              <button
                type="button"
                role="option"
                className="ar-tag-suggestion-item"
                key={item.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
