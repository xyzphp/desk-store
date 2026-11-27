import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon, useMessages } from '@xyzos/desk-ui';
import type { ArticleTaxonomy, TaxonomyKind } from './api';
import { categoryAndDescendantIDs, categoryDepth } from './model';
import type { useArticles } from './useArticles';
import { articleMessages, articleText } from './locale';

type ArticleState = ReturnType<typeof useArticles>;

/** 站点设置里的行内编辑：当前正在新建（根 / 某分类下 / 标签）或重命名的项，同一时间只有一处。 */
interface SiteInline {
  adding: { kind: TaxonomyKind; parentId: number } | null;
  editingId: number | null;
  startAdd: (kind: TaxonomyKind, parentId?: number) => void;
  startEdit: (id: number) => void;
  cancel: () => void;
  create: (kind: TaxonomyKind, parentId: number, name: string) => Promise<void>;
  rename: (item: ArticleTaxonomy, name: string) => Promise<void>;
}

/** 行内表单：输入框 + 确认 / 取消，Enter 提交、Esc 取消，不弹窗；失败时保留输入并显示原因。 */
function SiteInlineForm({
  initial = '',
  placeholder,
  label,
  confirmTitle,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder?: string;
  label: string;
  confirmTitle: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useMessages(articleMessages);
  const [name, setName] = useState(initial);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) {
      setError(t.site.taxonomy.nameRequired);
      input.current?.focus();
      return;
    }
    if (value === initial) {
      onCancel();
      return;
    }
    setPending(true);
    setError('');
    try {
      await onSubmit(value);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t.site.taxonomy.saveFailed);
      input.current?.focus();
    } finally {
      setPending(false);
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };
  return (
    <form className="ar-site-inline-form" onSubmit={(event) => void submit(event)} onKeyDown={keyDown}>
      <input
        ref={input}
        type="text"
        className="ar-site-inline-input"
        name="name"
        maxLength={40}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={name}
        required
        disabled={pending}
        onChange={(event) => {
          setName(event.currentTarget.value);
          setError('');
        }}
      />
      <div className="ar-site-inline-actions">
        <button
          type="submit"
          className="ar-site-inline-btn is-confirm"
          title={confirmTitle}
          aria-label={confirmTitle}
          disabled={pending}
        >
          <Icon className="xyz-icon lucide" name="check" />
        </button>
        <button
          type="button"
          className="ar-site-inline-btn is-cancel"
          title={t.common.cancel}
          aria-label={t.common.cancel}
          disabled={pending}
          onClick={onCancel}
        >
          <Icon className="xyz-icon lucide" name="x" />
        </button>
      </div>
      {error && (
        <p role="alert" className="ar-site-inline-error">
          {error}
        </p>
      )}
    </form>
  );
}

async function remove(state: ArticleState, item: ArticleTaxonomy) {
  const t = articleText();
  const label = item.kind === 'category' ? t.common.category : t.common.tag;
  if (
    !(await state.dialogs.confirm({
      title: t.site.taxonomy.deleteConfirm(label, item.name),
      message: t.site.taxonomy.deleteInUse,
      danger: true,
    }))
  )
    return;
  try {
    await state.mutateTaxonomy({ ...item, action: 'delete' });
  } catch (failure) {
    state.setError(failure instanceof Error ? failure.message : t.site.taxonomy.deleteFailed(label));
  }
}

async function moveCategory(state: ArticleState, item: ArticleTaxonomy, parentId: number) {
  if (item.parentId === parentId || item.id === parentId) return;
  const taxonomies = state.catalog?.taxonomies ?? [];
  if (parentId && categoryAndDescendantIDs(item.id, taxonomies).has(parentId)) return;
  const parent = taxonomies.find((entry) => entry.id === parentId && entry.kind === 'category');
  if (parent && categoryDepth(parent, taxonomies) >= 3) return;
  try {
    await state.mutateTaxonomy({ ...item, parentId, action: 'save' });
  } catch (failure) {
    state.setError(failure instanceof Error ? failure.message : articleText().site.taxonomy.moveFailed);
  }
}

function CategoryNode({
  state,
  item,
  depth,
  inline,
}: {
  state: ArticleState;
  item: NonNullable<ArticleState['categoryTree']>[number];
  depth: number;
  inline: SiteInline;
}) {
  const t = useMessages(articleMessages);
  const editing = inline.editingId === item.id;
  const addingChild = inline.adding?.kind === 'category' && inline.adding.parentId === item.id;
  const items = state.catalog?.items ?? [];
  const descendants = categoryAndDescendantIDs(item.id, state.catalog?.taxonomies ?? []);
  const total = items.filter((article) => !article.trashedAt && descendants.has(article.categoryId)).length;
  const direct = items.filter((article) => !article.trashedAt && article.categoryId === item.id).length;
  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData('application/x-article-category'));
    const dragged = state.catalog?.taxonomies.find((entry) => entry.id === id && entry.kind === 'category');
    if (dragged) void moveCategory(state, dragged, item.id);
  };
  return (
    <div className="ar-site-tree-node">
      <div
        className={`ar-site-tree-row is-depth-${depth}`}
        data-ar-site-cat-id={item.id}
        draggable={!editing}
        onDragStart={(event) => event.dataTransfer.setData('application/x-article-category', String(item.id))}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <div className="ar-site-tree-info">
          <span className="ar-site-tree-drag-handle" aria-label={t.site.taxonomy.dragAria}>
            <Icon className="xyz-icon lucide" name="grip-vertical" />
          </span>
          <span className="ar-site-tree-branch-glyph">
            <Icon className="xyz-icon lucide" name={item.children.length ? 'folder-open' : 'folder'} />
          </span>
          {editing ? (
            <SiteInlineForm
              initial={item.name}
              label={t.site.taxonomy.renameCategory}
              confirmTitle={t.common.saveChanges}
              onSubmit={(name) => inline.rename(item, name)}
              onCancel={inline.cancel}
            />
          ) : (
            <>
              <strong className="ar-site-tree-name">{item.name}</strong>
              <span className="ar-site-tree-count-pill">
                {t.site.taxonomy.count(total)}
                {total !== direct ? t.site.taxonomy.directSuffix(direct) : ''}
              </span>
            </>
          )}
        </div>
        <div className="ar-site-tree-actions" hidden={editing}>
          {depth < 3 && (
            <button type="button" className="ar-button" onClick={() => inline.startAdd('category', item.id)}>
              <Icon className="xyz-icon lucide" name="plus" />
              {t.site.taxonomy.addChild}
            </button>
          )}
          <button type="button" className="ar-button" onClick={() => inline.startEdit(item.id)}>
            <Icon className="xyz-icon lucide" name="pencil" />
            {t.common.rename}
          </button>
          <button type="button" className="ar-button ar-danger" onClick={() => void remove(state, item)}>
            <Icon className="xyz-icon lucide" name="trash-2" />
            {t.common.delete}
          </button>
        </div>
      </div>
      {(item.children.length > 0 || addingChild) && (
        <div className="ar-site-tree-children">
          {addingChild && (
            <div className={`ar-site-inline-row is-depth-${depth + 1}`}>
              <span className="ar-site-tree-branch-glyph" aria-hidden="true">
                <Icon className="xyz-icon lucide" name="folder" />
              </span>
              <SiteInlineForm
                label={t.site.taxonomy.childNameLabel}
                placeholder={t.site.taxonomy.childNamePlaceholder}
                confirmTitle={t.site.taxonomy.confirmAdd}
                onSubmit={(name) => inline.create('category', item.id, name)}
                onCancel={inline.cancel}
              />
            </div>
          )}
          {item.children.map((child) => (
            <CategoryNode key={child.id} state={state} item={child} depth={depth + 1} inline={inline} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ArticleSiteTaxonomies({ state, kind }: { state: ArticleState; kind: TaxonomyKind }) {
  const t = useMessages(articleMessages);
  const taxonomies = state.catalog?.taxonomies ?? [];
  const [adding, setAdding] = useState<SiteInline['adding']>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const inline: SiteInline = {
    adding,
    editingId,
    startAdd: (addKind, parentId = 0) => {
      setEditingId(null);
      setAdding({ kind: addKind, parentId });
    },
    startEdit: (id) => {
      setAdding(null);
      setEditingId(id);
    },
    cancel: () => {
      setAdding(null);
      setEditingId(null);
    },
    create: async (createKind, parentId, name) => {
      await state.mutateTaxonomy({ id: 0, kind: createKind, name, parentId, revision: 0, action: 'save' });
      state.setError('');
      setAdding(null);
    },
    rename: async (item, name) => {
      await state.mutateTaxonomy({ ...item, name, action: 'save' });
      state.setError('');
      setEditingId(null);
    },
  };
  if (kind === 'category') {
    const categories = taxonomies.filter((item) => item.kind === 'category');
    return (
      <section className="ar-site-settings-group ar-site-tax-mgmt-group">
        <header className="ar-site-tax-mgmt-header">
          <div>
            <h3>
              <Icon className="xyz-icon lucide" name="folder" />
              {t.site.taxonomy.categoryTitle(categories.length)}
            </h3>
          </div>
          <button
            type="button"
            className="ar-primary"
            data-ar-site-cat-add-root
            onClick={() => inline.startAdd('category')}
          >
            <Icon className="xyz-icon lucide" name="plus" />
            {t.site.taxonomy.addRootCategory}
          </button>
        </header>
        <div className="ar-site-tax-tree-wrap" data-ar-site-cat-tree-wrap>
          <div
            className="ar-site-tree-root-dropzone"
            data-ar-site-root-dropzone
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const id = Number(event.dataTransfer.getData('application/x-article-category'));
              const item = categories.find((entry) => entry.id === id);
              if (item) void moveCategory(state, item, 0);
            }}
          >
            <Icon className="xyz-icon lucide" name="folder" />
            <span>{t.site.taxonomy.rootDropzone}</span>
          </div>
          {adding?.kind === 'category' && adding.parentId === 0 && (
            <div className="ar-site-inline-row is-depth-1">
              <span className="ar-site-tree-branch-glyph" aria-hidden="true">
                <Icon className="xyz-icon lucide" name="folder" />
              </span>
              <SiteInlineForm
                label={t.site.taxonomy.rootNameLabel}
                placeholder={t.site.taxonomy.rootNamePlaceholder}
                confirmTitle={t.site.taxonomy.confirmAdd}
                onSubmit={(name) => inline.create('category', 0, name)}
                onCancel={inline.cancel}
              />
            </div>
          )}
          {state.categoryTree.length ? (
            state.categoryTree.map((item) => (
              <CategoryNode key={item.id} state={state} item={item} depth={1} inline={inline} />
            ))
          ) : adding?.kind === 'category' ? null : (
            <div className="ar-empty-list">
              <Icon className="xyz-icon lucide" name="folder" />
              <span>{t.site.taxonomy.emptyCategories}</span>
            </div>
          )}
        </div>
      </section>
    );
  }
  const tags = taxonomies.filter((item) => item.kind === 'tag');
  return (
    <section className="ar-site-settings-group ar-site-tax-mgmt-group">
      <header className="ar-site-tax-mgmt-header">
        <div>
          <h3>
            <Icon className="xyz-icon lucide" name="bookmark" />
            {t.site.taxonomy.tagTitle(tags.length)}
          </h3>
        </div>
        <button type="button" className="ar-primary" data-ar-site-tag-add onClick={() => inline.startAdd('tag')}>
          <Icon className="xyz-icon lucide" name="plus" />
          {t.site.taxonomy.addTag}
        </button>
      </header>
      <div className="ar-site-tags-grid">
        {adding?.kind === 'tag' && (
          <div className="ar-site-tag-card is-inline-create">
            <div className="ar-site-tag-card-info">
              <span className="ar-site-tag-hash">#</span>
              <SiteInlineForm
                label={t.site.taxonomy.tagNameLabel}
                placeholder={t.site.taxonomy.tagNamePlaceholder}
                confirmTitle={t.site.taxonomy.confirmAdd}
                onSubmit={(name) => inline.create('tag', 0, name)}
                onCancel={inline.cancel}
              />
            </div>
          </div>
        )}
        {tags.length || adding?.kind === 'tag' ? (
          tags.map((item) => {
            const count =
              state.catalog?.items.filter((article) => !article.trashedAt && article.tagIds.includes(item.id)).length ??
              0;
            if (editingId === item.id)
              return (
                <div className="ar-site-tag-card is-inline-create" data-ar-site-tag-id={item.id} key={item.id}>
                  <div className="ar-site-tag-card-info">
                    <span className="ar-site-tag-hash">#</span>
                    <SiteInlineForm
                      initial={item.name}
                      label={t.site.taxonomy.renameTag}
                      confirmTitle={t.common.saveChanges}
                      onSubmit={(name) => inline.rename(item, name)}
                      onCancel={inline.cancel}
                    />
                  </div>
                </div>
              );
            return (
              <article className="ar-site-tag-card" data-ar-site-tag-id={item.id} key={item.id}>
                <div className="ar-site-tag-card-info">
                  <span className="ar-site-tag-hash">#</span>
                  <strong className="ar-site-tag-title" title={item.name}>
                    {item.name}
                  </strong>
                  <span className="ar-site-tree-count-pill">{t.site.taxonomy.count(count)}</span>
                </div>
                <div className="ar-site-tag-card-actions">
                  <button
                    type="button"
                    className="ar-button"
                    data-ar-site-tag-edit={item.id}
                    onClick={() => inline.startEdit(item.id)}
                  >
                    <Icon className="xyz-icon lucide" name="pencil" />
                    {t.common.rename}
                  </button>
                  <button
                    type="button"
                    className="ar-button ar-danger"
                    data-ar-site-tag-del={item.id}
                    onClick={() => void remove(state, item)}
                  >
                    <Icon className="xyz-icon lucide" name="trash-2" />
                    {t.common.delete}
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="ar-empty-list">
            <Icon className="xyz-icon lucide" name="bookmark" />
            <span>{t.site.taxonomy.emptyTags}</span>
          </div>
        )}
      </div>
    </section>
  );
}
