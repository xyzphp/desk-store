import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, useMessages } from '@xyzos/desk-ui';
import type { ArticleTaxonomy } from './api';
import type { useArticles } from './useArticles';
import { articleMessages, articleText, type ArticleMessages } from './locale';

type ArticleState = ReturnType<typeof useArticles>;

/** 正在行内编辑或确认删除的分类 / 标签，同一时间只有一项。 */
export interface TaxonomyInlineTarget {
  kind: ArticleTaxonomy['kind'];
  id: number;
}

export const sameTarget = (target: TaxonomyInlineTarget | null, item: ArticleTaxonomy) =>
  target?.kind === item.kind && target.id === item.id;

const kindLabel = (kind: ArticleTaxonomy['kind'], t: ArticleMessages) =>
  kind === 'category' ? t.common.category : t.common.tag;

/** 侧栏行内重命名：原地替换名称为输入框，Enter 保存、Esc 或取消按钮放弃，不弹窗。 */
export function TaxonomyRenameRow({
  item,
  className = '',
  disabled,
  onSave,
  onCancel,
}: {
  item: ArticleTaxonomy;
  className?: string;
  disabled: boolean;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useMessages(articleMessages);
  const [name, setName] = useState(item.name);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const label = kindLabel(item.kind, t);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const save = async () => {
    const value = name.trim();
    if (!value || value === item.name) {
      if (!value) {
        setError(t.inline.nameRequired(label));
        input.current?.focus();
        return;
      }
      onCancel();
      return;
    }
    setError('');
    try {
      await onSave(value);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t.inline.renameFailed);
      input.current?.focus();
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <>
      <div className={`ar-tax-item is-editing ${className}`.trim()} data-ar-tax-editing={`${item.kind}:${item.id}`}>
        <input
          ref={input}
          type="text"
          className="ar-tax-inline-input"
          maxLength={40}
          value={name}
          disabled={disabled}
          aria-label={t.inline.renameAria(label)}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setName(event.currentTarget.value);
            setError('');
          }}
          onKeyDown={keyDown}
        />
        <div className="ar-tax-item-actions">
          <button
            type="button"
            className="ar-tax-confirm"
            title={t.common.save}
            aria-label={t.common.save}
            disabled={disabled}
            onClick={() => void save()}
          >
            <Icon className="xyz-icon lucide" name="check" />
          </button>
          <button
            type="button"
            title={t.common.cancel}
            aria-label={t.common.cancel}
            disabled={disabled}
            onClick={onCancel}
          >
            <Icon className="xyz-icon lucide" name="x" />
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="ar-tax-inline-error">
          {error}
        </p>
      )}
    </>
  );
}

/** 侧栏行内删除确认：原地显示“删除？”与确认 / 取消，不弹窗；焦点落在确认按钮，Esc 取消。 */
export function TaxonomyDeleteRow({
  item,
  className = '',
  disabled,
  onConfirm,
  onCancel,
}: {
  item: ArticleTaxonomy;
  className?: string;
  disabled: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const t = useMessages(articleMessages);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => confirm.current?.focus(), []);
  return (
    <div
      className={`ar-tax-item is-deleting ${className}`.trim()}
      data-ar-tax-deleting={`${item.kind}:${item.id}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <span className="ar-tax-delete-tip" role="status">
        {t.inline.deleteConfirm(kindLabel(item.kind, t), item.name)}
      </span>
      <div className="ar-tax-item-actions">
        <button
          ref={confirm}
          type="button"
          className="ar-tax-confirm ar-danger"
          title={t.common.confirmDelete}
          aria-label={t.inline.confirmDeleteAria(kindLabel(item.kind, t), item.name)}
          disabled={disabled}
          onClick={() => void onConfirm()}
        >
          <Icon className="xyz-icon lucide" name="check" />
        </button>
        <button
          type="button"
          title={t.common.cancel}
          aria-label={t.common.cancel}
          disabled={disabled}
          onClick={onCancel}
        >
          <Icon className="xyz-icon lucide" name="x" />
        </button>
      </div>
    </div>
  );
}

/** 保存重命名；与原侧栏一致，修订号取当前项，失败时抛出由行内提示展示。 */
export async function saveTaxonomyName(state: ArticleState, item: ArticleTaxonomy, name: string) {
  const t = articleText();
  await state.mutateTaxonomy({
    id: item.id,
    kind: item.kind,
    name,
    parentId: item.parentId,
    revision: item.revision,
    action: 'save',
  });
  state.setError('');
  state.setStatus(t.inline.updated(kindLabel(item.kind, t)));
}

/** 确认删除；成功后清掉指向该项的筛选，失败信息走页面错误提示。 */
export async function deleteTaxonomyItem(state: ArticleState, item: ArticleTaxonomy) {
  const t = articleText();
  try {
    await state.mutateTaxonomy({
      id: item.id,
      kind: item.kind,
      name: item.name,
      parentId: item.parentId,
      revision: item.revision,
      action: 'delete',
    });
    if (item.id === state.category) state.setFilter({ category: 0 });
    if (item.id === state.tag) state.setFilter({ tag: 0 });
    state.setStatus(t.inline.deleted(kindLabel(item.kind, t)));
  } catch (failure) {
    state.setError(failure instanceof Error ? failure.message : t.inline.deleteFailed(kindLabel(item.kind, t)));
  }
}
