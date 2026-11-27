import { useEffect, useState, type MouseEvent } from 'react';
import { Icon, useMessages } from '@xyzos/desk-ui';
import { buildCategoryTree, categoryAncestorIDs, categoryPath, type ArticleCategoryNode } from './model';
import type { ArticleTaxonomy } from './api';
import { articleMessages } from './locale';

function columnItems(roots: ArticleCategoryNode[], parents: readonly number[], level: number): ArticleCategoryNode[] {
  if (!level) return roots;
  let current = roots;
  for (const id of parents.slice(0, level)) current = current.find((item) => item.id === id)?.children ?? [];
  return current;
}

export function ArticleCascader({
  value,
  taxonomies,
  disabled,
  onChange,
}: {
  value: number;
  taxonomies: readonly ArticleTaxonomy[];
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const t = useMessages(articleMessages);
  const [open, setOpen] = useState(false);
  const [parents, setParents] = useState<number[]>(() => categoryAncestorIDs(value, taxonomies));
  const tree = buildCategoryTree(taxonomies);
  const current = taxonomies.find((item) => item.id === value && item.kind === 'category');
  useEffect(() => {
    if (!open) setParents(categoryAncestorIDs(value, taxonomies));
  }, [open, taxonomies, value]);

  const choose = (item: ArticleCategoryNode, level: number) => {
    const selectedPath = parents[level] === item.id;
    if (item.children.length && level < 2 && !selectedPath) {
      setParents([...parents.slice(0, level), item.id]);
      return;
    }
    onChange(item.id);
    setOpen(false);
  };
  const expand = (event: MouseEvent<HTMLSpanElement>, item: ArticleCategoryNode, level: number) => {
    event.stopPropagation();
    setParents(parents[level] === item.id ? parents.slice(0, level) : [...parents.slice(0, level), item.id]);
  };

  return (
    <div className={`ar-cascader-wrap${open ? ' is-open' : ''}`} data-ar-cascader-wrap>
      <button
        type="button"
        className="ar-meta-pill ar-dropdown-btn"
        data-ar-cascader-trigger
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon
          className="xyz-icon lucide"
          name={
            current && tree.some((item) => item.id === current.id && item.children.length) ? 'folder-open' : 'folder'
          }
        />
        <span className="ar-dropdown-label">{categoryPath(current, taxonomies) || t.common.uncategorized}</span>
        <span className="ar-select-chevron" aria-hidden="true">
          <Icon className="xyz-icon lucide" name="chevron-down" />
        </span>
      </button>
      {open && (
        <div className="ar-cascader-panel" data-ar-cascader-panel role="listbox" aria-label={t.cascader.panelAria}>
          {[0, 1, 2].map((level) => {
            const items = columnItems(tree, parents, level);
            if (level > 0 && !items.length) return null;
            return (
              <div
                className="ar-cascader-column"
                data-ar-cascader-column={level}
                role="group"
                aria-label={t.cascader.levelLabel(level + 1)}
                key={level}
              >
                {level === 0 && (
                  <button
                    type="button"
                    className={`ar-cascader-item${value === 0 ? ' is-selected' : ''}`}
                    data-ar-cascader-col="0"
                    data-ar-cascader-select="0"
                    role="option"
                    aria-selected={value === 0}
                    title={t.cascader.setUncategorized}
                    onClick={() => {
                      onChange(0);
                      setOpen(false);
                    }}
                  >
                    <span className="ar-cascader-item-label">{t.common.uncategorized}</span>
                  </button>
                )}
                {items.map((item) => {
                  const selected = value === item.id;
                  const expanded = parents[level] === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`ar-cascader-item${selected ? ' is-selected' : ''}${expanded ? ' is-expanded' : ''}`}
                      data-ar-cascader-col={level}
                      data-ar-cascader-select={item.id}
                      role="option"
                      aria-selected={selected}
                      title={
                        item.children.length
                          ? expanded
                            ? t.cascader.expandedTitle(item.name)
                            : t.cascader.expandTitle(item.name)
                          : t.cascader.selectTitle(item.name)
                      }
                      onClick={() => choose(item, level)}
                    >
                      <Icon className="xyz-icon lucide" name={item.children.length ? 'folder-open' : 'folder'} />
                      <span className="ar-cascader-item-label">{item.name}</span>
                      {item.children.length > 0 && (
                        <span
                          className="ar-cascader-item-arrow"
                          data-ar-cascader-expand={item.id}
                          data-ar-cascader-col={level}
                          role="button"
                          tabIndex={0}
                          aria-label={expanded ? t.cascader.collapseChildren : t.cascader.expandChildren}
                          title={expanded ? t.cascader.collapseChildren : t.cascader.expandChildren}
                          onClick={(event) => expand(event, item, level)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setParents(expanded ? parents.slice(0, level) : [...parents.slice(0, level), item.id]);
                            }
                          }}
                        >
                          <Icon className="xyz-icon lucide" name="chevron-right" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
