import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon, NavItem, NavSidebar, useMessages } from '@xyzos/desk-ui';
import { useHost } from '../../host/HostProvider';
import { isAbort } from '../../shared/hooks/useRequest';
import { categoryPath, visibleArticles, type ArticleCategoryNode } from './model';
import type { ArticleTaxonomy, TaxonomyKind } from './api';
import type { useArticles } from './useArticles';
import { articleMessages } from './locale';
import {
  TaxonomyDeleteRow,
  TaxonomyRenameRow,
  deleteTaxonomyItem,
  saveTaxonomyName,
  sameTarget,
  type TaxonomyInlineTarget,
} from './ArticleTaxonomyInline';

type ArticleState = ReturnType<typeof useArticles>;

function TaxonomyCreateForm({
  kind,
  parentId,
  disabled,
  onCreate,
  onCancel,
}: {
  kind: TaxonomyKind;
  parentId: number;
  disabled: boolean;
  onCreate: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useMessages(articleMessages);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const label = kind === 'category' ? (parentId ? t.sidebar.childCategory : t.common.category) : t.common.tag;
  const errorId = `ar-tax-create-error-${kind}-${parentId}`;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) {
      setError(t.sidebar.nameRequired(label));
      inputRef.current?.focus();
      return;
    }
    setError('');
    try {
      await onCreate(value);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t.sidebar.addFailed(label));
      inputRef.current?.focus();
    }
  };

  const keyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (disabled || event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };

  return (
    <form className="ar-tax-create" onSubmit={(event) => void submit(event)} onKeyDown={keyDown}>
      <div className="ar-tax-create-row">
        <label>
          {kind === 'category' ? <Icon className="xyz-icon lucide" name="folder" /> : <span aria-hidden="true">#</span>}
          <input
            ref={inputRef}
            name="name"
            maxLength={40}
            placeholder={t.sidebar.namePlaceholder(label)}
            aria-label={t.sidebar.newNameAria(label)}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            value={name}
            required
            disabled={disabled}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setError('');
            }}
          />
        </label>
        <div className="ar-tax-create-actions">
          <button
            type="submit"
            className="ar-tax-confirm"
            title={t.sidebar.addAction(label)}
            aria-label={t.common.add}
            disabled={disabled}
          >
            <Icon className="xyz-icon lucide" name="check" />
          </button>
          <button
            type="button"
            title={t.sidebar.cancelAdd(label)}
            aria-label={t.common.cancel}
            disabled={disabled}
            onClick={onCancel}
          >
            <Icon className="xyz-icon lucide" name="x" />
          </button>
        </div>
      </div>
      <p id={errorId} role="alert" className="ar-tax-create-error">
        {error}
      </p>
    </form>
  );
}

async function selectFilter(state: ArticleState, filter: Parameters<ArticleState['setFilter']>[0]) {
  if (state.siteOpen && !(await state.closeSite())) return;
  state.setFilter(filter);
}

/** 侧栏行内编辑状态：同一时间只有一行处于“重命名”或“确认删除”。 */
interface InlineController {
  editing: TaxonomyInlineTarget | null;
  deleting: TaxonomyInlineTarget | null;
  edit: (item: ArticleTaxonomy) => void;
  remove: (item: ArticleTaxonomy) => void;
  cancel: () => void;
  save: (item: ArticleTaxonomy, name: string) => Promise<void>;
  confirmDelete: (item: ArticleTaxonomy) => Promise<void>;
}

function TaxonomyRow({
  node,
  depth,
  state,
  addingChildParentId,
  taxonomyBusy,
  inline,
  onAddChild,
  onCancelChild,
  onCreate,
}: {
  node: ArticleCategoryNode;
  depth: number;
  state: ArticleState;
  addingChildParentId: number | null;
  taxonomyBusy: boolean;
  inline: InlineController;
  onAddChild: (parentId: number) => void;
  onCancelChild: () => void;
  onCreate: (kind: TaxonomyKind, parentId: number, name: string) => Promise<void>;
}) {
  const t = useMessages(articleMessages);
  const expanded = !state.collapsedCategoryIds.includes(node.id);
  const selected = state.category === node.id;
  const count = visibleArticles(
    state.catalog?.items ?? [],
    { view: 'all', query: '', category: node.id, tag: 0 },
    state.catalog?.taxonomies ?? [],
  ).length;
  const toggleNode = () =>
    state.setCollapsedCategoryIds((current) =>
      expanded ? [...new Set([...current, node.id])] : current.filter((id) => id !== node.id),
    );
  return (
    <div className="ar-cat-branch" key={node.id}>
      {sameTarget(inline.editing, node) ? (
        <TaxonomyRenameRow
          item={node}
          className={`ar-cat-depth-${depth}`}
          disabled={state.busy || taxonomyBusy}
          onSave={(name) => inline.save(node, name)}
          onCancel={inline.cancel}
        />
      ) : sameTarget(inline.deleting, node) ? (
        <TaxonomyDeleteRow
          item={node}
          className={`ar-cat-depth-${depth}`}
          disabled={state.busy || taxonomyBusy}
          onConfirm={() => inline.confirmDelete(node)}
          onCancel={inline.cancel}
        />
      ) : (
        <div className={`ar-tax-item ar-cat-depth-${depth}${selected ? ' is-active' : ''}`}>
          {node.children.length > 0 ? (
            <button
              type="button"
              className="ar-tree-toggle-btn"
              aria-label={expanded ? t.sidebar.collapseChildren : t.sidebar.expandChildren}
              aria-expanded={expanded}
              onClick={toggleNode}
            >
              <Icon className="xyz-icon lucide" name={expanded ? 'chevron-down' : 'chevron-right'} />
            </button>
          ) : (
            <span className="ar-tree-leaf-spacer" />
          )}
          <button
            type="button"
            className="ar-tax-btn"
            aria-pressed={selected}
            onClick={() => void selectFilter(state, { category: selected ? 0 : node.id, tag: 0 })}
          >
            <span className="ar-cat-name" title={categoryPath(node, state.catalog?.taxonomies ?? [])}>
              {node.name}
            </span>
            <span className="ar-cat-count">{count}</span>
          </button>
          <span className="ar-tax-item-actions">
            <button
              type="button"
              aria-label={t.sidebar.renameCategory(node.name)}
              title={t.common.rename}
              onClick={() => inline.edit(node)}
            >
              <Icon className="xyz-icon lucide" name="pencil" />
            </button>
            {depth < 3 && (
              <button
                type="button"
                aria-label={t.sidebar.addChildTo(node.name)}
                title={t.sidebar.addChild}
                disabled={state.busy || taxonomyBusy}
                onClick={() => onAddChild(node.id)}
              >
                <Icon className="xyz-icon lucide" name="plus" />
              </button>
            )}
            <button
              type="button"
              className="ar-danger"
              aria-label={t.sidebar.deleteCategory(node.name)}
              title={t.common.delete}
              onClick={() => inline.remove(node)}
            >
              <Icon className="xyz-icon lucide" name="trash-2" />
            </button>
          </span>
        </div>
      )}
      {addingChildParentId === node.id && (
        <div className={`ar-cat-inline-create ar-cat-depth-${depth + 1}`}>
          <TaxonomyCreateForm
            kind="category"
            parentId={node.id}
            disabled={state.busy || taxonomyBusy}
            onCreate={(name) => onCreate('category', node.id, name)}
            onCancel={onCancelChild}
          />
        </div>
      )}
      {node.children.length > 0 && (
        <div className="ar-cat-children" hidden={!expanded}>
          {node.children.map((child) => (
            <TaxonomyRow
              key={child.id}
              node={child}
              depth={depth + 1}
              state={state}
              addingChildParentId={addingChildParentId}
              taxonomyBusy={taxonomyBusy}
              inline={inline}
              onAddChild={onAddChild}
              onCancelChild={onCancelChild}
              onCreate={onCreate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaxonomyHeading({
  kind,
  label,
  collapsed,
  disabled,
  onToggle,
  onAdd,
  onOpen,
}: {
  kind: TaxonomyKind;
  label: string;
  collapsed: boolean;
  disabled: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const t = useMessages(articleMessages);
  return (
    <div className="ar-side-heading" data-ar-heading-kind={kind}>
      <button type="button" className="ar-side-heading-text" data-ar-tax-open-tab={kind} onClick={onOpen}>
        <Icon className="xyz-icon lucide" name={kind === 'category' ? 'folder' : 'bookmark'} />
        <span>{label}</span>
      </button>
      <div className="ar-side-heading-actions">
        <button
          type="button"
          aria-label={t.sidebar.addAction(label)}
          title={t.sidebar.addAction(label)}
          disabled={disabled}
          onClick={onAdd}
        >
          <Icon className="xyz-icon lucide" name="plus" />
        </button>
        <button
          type="button"
          className={collapsed ? 'ar-side-collapse-trigger is-collapsed' : 'ar-side-collapse-trigger'}
          aria-label={collapsed ? t.sidebar.expandLabel(label) : t.sidebar.collapseLabel(label)}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <Icon className="xyz-icon lucide" name={collapsed ? 'chevron-right' : 'chevron-down'} />
        </button>
      </div>
    </div>
  );
}

export function ArticleSidebar({ state }: { state: ArticleState }) {
  const t = useMessages(articleMessages);
  const [addingCategory, setAddingCategory] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [addingChildParentId, setAddingChildParentId] = useState<number | null>(null);
  const [taxonomyBusy, setTaxonomyBusy] = useState(false);
  const [editing, setEditing] = useState<TaxonomyInlineTarget | null>(null);
  const [deleting, setDeleting] = useState<TaxonomyInlineTarget | null>(null);
  const host = useHost();
  const views = [
    ['all', 'files'],
    ['draft', 'file-text'],
    ['private', 'lock'],
    ['public', 'globe'],
    ['trash', 'trash-2'],
  ] as const;
  const tree = state.categoryTree;
  const inline: InlineController = {
    editing,
    deleting,
    edit: (item) => {
      setDeleting(null);
      setEditing({ kind: item.kind, id: item.id });
    },
    remove: (item) => {
      setEditing(null);
      setDeleting({ kind: item.kind, id: item.id });
    },
    cancel: () => {
      setEditing(null);
      setDeleting(null);
    },
    save: async (item, name) => {
      await saveTaxonomyName(state, item, name);
      setEditing(null);
    },
    confirmDelete: async (item) => {
      await deleteTaxonomyItem(state, item);
      setDeleting(null);
    },
  };
  const createTaxonomy = async (kind: TaxonomyKind, parentId: number, name: string) => {
    if (state.busy || taxonomyBusy) {
      await state.dialogs.alert({ title: t.sidebar.busyTitle, message: t.sidebar.busyMessage });
      return;
    }
    setTaxonomyBusy(true);
    try {
      await state.mutateTaxonomy({ id: 0, kind, name, parentId, revision: 0, action: 'save' });
      if (parentId) setAddingChildParentId(null);
      else if (kind === 'category') setAddingCategory(false);
      else setAddingTag(false);
      state.setError('');
      state.setStatus(t.sidebar.taxonomyAdded(kind === 'category' ? t.common.category : t.common.tag));
    } catch (failure) {
      if (!isAbort(failure)) {
        const label = kind === 'category' ? (parentId ? t.sidebar.childCategory : t.common.category) : t.common.tag;
        await state.dialogs.alert({
          title: t.sidebar.addFailed(label),
          message: failure instanceof Error ? failure.message : t.sidebar.addFailedRetry(label),
        });
      }
    } finally {
      setTaxonomyBusy(false);
    }
  };
  return (
    <NavSidebar
      as="aside"
      title={t.sidebar.title}
      className="ar-sidebar"
      aria-label={t.sidebar.aria}
      style={{ width: state.sidebarWidth }}
      footer={
        <>
          {state.isAdmin ? (
            <NavItem
              className="ar-nav-item"
              icon="settings-2"
              current={state.siteOpen}
              data-ar-site-open
              aria-pressed={state.siteOpen}
              onClick={() => void state.openSite()}
            >
              <span className="ar-nav-label">{t.sidebar.siteSettings}</span>
            </NavItem>
          ) : null}
          <div className="ar-sidebar-public-actions" role="group" aria-label={t.sidebar.publicGroup}>
            <NavItem
              className="ar-public-open-app-btn"
              icon="globe"
              title={t.sidebar.openInTab}
              onClick={() => {
                void host.openPublicSite('').catch((failure: unknown) => {
                  state.setError(failure instanceof Error ? failure.message : t.sidebar.openAppFailed);
                });
              }}
            >
              <span className="ar-nav-label">{t.sidebar.publicSite}</span>
              <Icon className="xyz-icon lucide" name="external-link" />
            </NavItem>
          </div>
        </>
      }
    >
      <nav data-ar-nav aria-label={t.sidebar.viewsGroup}>
        {views.map(([view, glyph]) => (
          <NavItem
            key={view}
            className="ar-nav-item"
            icon={glyph}
            current={state.view === view && !state.category && !state.tag}
            data-ar-view={view}
            aria-pressed={state.view === view && !state.category && !state.tag}
            onClick={() => void selectFilter(state, { view, category: 0, tag: 0 })}
          >
            <span className="ar-nav-label">{t.sidebar.views[view]}</span>
            <small className="ar-nav-count">
              {
                visibleArticles(
                  state.catalog?.items ?? [],
                  { view, query: '', category: 0, tag: 0 },
                  state.catalog?.taxonomies ?? [],
                ).length
              }
            </small>
          </NavItem>
        ))}
      </nav>
      <TaxonomyHeading
        kind="category"
        label={t.common.category}
        collapsed={state.categoriesCollapsed}
        disabled={state.busy || taxonomyBusy}
        onToggle={() => state.setCategoriesCollapsed((value) => !value)}
        onAdd={() => setAddingCategory(true)}
        onOpen={() => void state.openSite('categories')}
      />
      <nav data-ar-categories aria-label={t.sidebar.categoriesAria} hidden={state.categoriesCollapsed}>
        {!tree.length ? (
          <div className="ar-tax-empty-tip">{t.sidebar.emptyCategories}</div>
        ) : (
          tree.map((node) => (
            <TaxonomyRow
              key={node.id}
              node={node}
              depth={1}
              state={state}
              addingChildParentId={addingChildParentId}
              taxonomyBusy={taxonomyBusy}
              inline={inline}
              onAddChild={setAddingChildParentId}
              onCancelChild={() => setAddingChildParentId(null)}
              onCreate={createTaxonomy}
            />
          ))
        )}
      </nav>
      <div data-ar-tax-entry="category" hidden={state.categoriesCollapsed}>
        {addingCategory && (
          <TaxonomyCreateForm
            kind="category"
            parentId={0}
            disabled={state.busy || taxonomyBusy}
            onCreate={(name) => createTaxonomy('category', 0, name)}
            onCancel={() => setAddingCategory(false)}
          />
        )}
      </div>
      <TaxonomyHeading
        kind="tag"
        label={t.common.tag}
        collapsed={state.tagsCollapsed}
        disabled={state.busy || taxonomyBusy}
        onToggle={() => state.setTagsCollapsed((value) => !value)}
        onAdd={() => setAddingTag(true)}
        onOpen={() => void state.openSite('tags')}
      />
      <nav data-ar-tags aria-label={t.sidebar.tagsAria} hidden={state.tagsCollapsed}>
        {state.tagItems.length === 0 ? (
          <div className="ar-tax-empty-tip">{t.sidebar.emptyTags}</div>
        ) : (
          state.tagItems.map((item) => {
            const count =
              state.catalog?.items.filter((article) => !article.trashedAt && article.tagIds?.includes(item.id))
                .length ?? 0;
            const selected = state.tag === item.id;
            if (sameTarget(editing, item))
              return (
                <TaxonomyRenameRow
                  key={item.id}
                  item={item}
                  disabled={state.busy || taxonomyBusy}
                  onSave={(name) => inline.save(item, name)}
                  onCancel={inline.cancel}
                />
              );
            if (sameTarget(deleting, item))
              return (
                <TaxonomyDeleteRow
                  key={item.id}
                  item={item}
                  disabled={state.busy || taxonomyBusy}
                  onConfirm={() => inline.confirmDelete(item)}
                  onCancel={inline.cancel}
                />
              );
            return (
              <div key={item.id} className={`ar-tax-item${selected ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className="ar-tax-btn"
                  aria-pressed={selected}
                  onClick={() => void selectFilter(state, { tag: selected ? 0 : item.id, category: 0 })}
                >
                  <span className="ar-tag-hash">#</span>
                  <span className="ar-cat-name">{item.name}</span>
                  <span className="ar-cat-count">{count}</span>
                </button>
                <span className="ar-tax-item-actions">
                  <button
                    type="button"
                    aria-label={t.sidebar.renameTag(item.name)}
                    title={t.common.rename}
                    onClick={() => inline.edit(item)}
                  >
                    <Icon className="xyz-icon lucide" name="pencil" />
                  </button>
                  <button
                    type="button"
                    className="ar-danger"
                    aria-label={t.sidebar.deleteTag(item.name)}
                    title={t.common.delete}
                    onClick={() => inline.remove(item)}
                  >
                    <Icon className="xyz-icon lucide" name="trash-2" />
                  </button>
                </span>
              </div>
            );
          })
        )}
      </nav>
      <div data-ar-tax-entry="tag" hidden={state.tagsCollapsed}>
        {addingTag && (
          <TaxonomyCreateForm
            kind="tag"
            parentId={0}
            disabled={state.busy || taxonomyBusy}
            onCreate={(name) => createTaxonomy('tag', 0, name)}
            onCancel={() => setAddingTag(false)}
          />
        )}
      </div>
    </NavSidebar>
  );
}
