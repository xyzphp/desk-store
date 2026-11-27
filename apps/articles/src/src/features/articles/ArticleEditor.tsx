import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon, useMessages } from '@xyzos/desk-ui';
import { MarkdownVisualEditor, type MarkdownVisualEditorHandle } from '../../shared/markdown/MarkdownVisualEditor';
import { TextAIEditor } from '../../shared/ai/TextAIEditor';
import { FilePickerDialog } from '../../shared/files/FilePickerDialog';
import { AppImage, downloadBackendFile, useArticleMediaMap } from '../../shared/sdk/media';
import { articleFileId, type ArticleFile } from './api';
import { ArticleCascader } from './ArticleCascader';
import { ArticleContentImageAI } from './ArticleContentImageAI';
import { ArticleCoverPicker } from './ArticleCoverPicker';
import { ArticleFormAI } from './ArticleFormAI';
import { articleFormAIFields } from './articleFormAIModel';
import { ArticleTagEditor } from './ArticleTagEditor';
import { visibleAttachmentFileIDs } from './model';
import type { useArticles } from './useArticles';
import type { ArticleContentImageSelection, ArticleContentImageUse } from './useArticleContentImageAI';
import { currentLocale } from '../../shared/i18n/current';
import { articleMessages, type ArticleMessages } from './locale';

type ArticleState = ReturnType<typeof useArticles>;

interface EditorHistory {
  values: string[];
  selections: Array<[number, number]>;
  index: number;
  timer?: number;
}

const formatItems = [
  ['bold', 'bold'],
  ['italic', 'italic'],
  ['heading', 'heading'],
  ['quote', 'quote'],
  ['code', 'code'],
  ['list-ul', 'list'],
  ['list-ol', 'list-ordered'],
  ['table', 'table'],
  ['hr', 'minus'],
  ['link', 'link'],
] as const;

function applyFormat(source: string, start: number, end: number, format: string, t: ArticleMessages) {
  const selected = source.slice(start, end);
  const pairs: Record<string, [string, string]> = {
    bold: ['**', '**'],
    italic: ['*', '*'],
    code: ['`', '`'],
    link: ['[', '](https://)'],
  };
  if (pairs[format]) {
    const [before, after] = pairs[format]!;
    return {
      value: `${source.slice(0, start)}${before}${selected || t.editor.textPlaceholder}${after}${source.slice(end)}`,
      start: start + before.length,
      end: start + before.length + (selected || t.editor.textPlaceholder).length,
    };
  }
  const prefix: Record<string, string> = {
    heading: '## ',
    quote: '> ',
    'list-ul': '- ',
    'list-ol': '1. ',
    table: t.editor.tableTemplate,
    hr: '\n---\n',
  };
  const insert = prefix[format] ?? '';
  return {
    value: `${source.slice(0, start)}${insert}${selected || (format === 'hr' ? '' : t.editor.textPlaceholder)}${source.slice(end)}`,
    start: start + insert.length,
    end: start + insert.length + selected.length,
  };
}

function Cover({ state, disabled, onOpen }: { state: ArticleState; disabled: boolean; onOpen: () => void }) {
  const t = useMessages(articleMessages);
  const draft = state.draft!;
  const file = state.files.find((item) => articleFileId(item) === draft.coverFileId);
  if (!draft.coverFileId)
    return (
      <button
        type="button"
        className="ar-meta-pill ar-cover-trigger"
        data-ar-pick-cover
        disabled={disabled}
        onClick={onOpen}
      >
        <Icon className="xyz-icon lucide" name="image" />
        <span>{t.editor.setCover}</span>
      </button>
    );
  const width = file?.width || draft.coverWidth;
  const height = file?.height || draft.coverHeight;
  const square = width > 0 && height > 0 && width / height < 1.45;
  return (
    <div className="ar-meta-pill ar-cover-pill" data-ar-cover-pill>
      <AppImage fileId={draft.coverFileId} alt={t.editor.coverAlt} className="ar-cover-thumb" />
      <span>{t.editor.coverSet}</span>
      <button type="button" data-ar-pick-cover aria-label={t.editor.changeCover} disabled={disabled} onClick={onOpen}>
        <Icon className="xyz-icon lucide" name="refresh-cw" />
      </button>
      <button
        type="button"
        className="ar-danger"
        data-ar-remove-cover
        aria-label={t.editor.removeCover}
        disabled={disabled}
        onClick={() => state.setDraft({ coverFileId: 0, coverWidth: 0, coverHeight: 0 })}
      >
        <Icon className="xyz-icon lucide" name="x" />
      </button>
      <span className="sr-only">{square ? t.editor.squareCover : t.editor.bannerCover}</span>
    </div>
  );
}

function FilePanel({
  state,
  open,
  onInsert,
  onUpload,
  onClose,
}: {
  state: ArticleState;
  open: boolean;
  onInsert: (file: ArticleState['files'][number]) => void;
  onUpload: (files: File[]) => void;
  onClose: () => void;
}) {
  const t = useMessages(articleMessages);
  const attached = new Set(state.draft?.fileIds ?? []);
  const items = state.files.flatMap((file) => {
    const id = articleFileId(file);
    if (!id) return [];
    const image = file.mediaType.startsWith('image/');
    return [
      {
        id: String(id),
        name: file.name,
        fileId: image ? id : undefined,
        mark: attached.has(id) ? t.editor.attached : undefined,
        secondary: image,
      },
    ];
  });
  const find = (id: string) => state.files.find((file) => articleFileId(file) === Number(id));
  return (
    <FilePickerDialog
      open={open}
      title={t.editor.pickFileTitle}
      items={items}
      busy={state.busy}
      onPick={(id) => {
        const file = find(id);
        if (!file) return;
        onInsert(file);
        onClose();
      }}
      secondaryLabel={t.editor.setAsCover}
      onSecondary={(id) => {
        const file = find(id);
        const fileId = file && articleFileId(file);
        if (!file || !fileId) return;
        state.setDraft({ coverFileId: fileId, coverWidth: file.width ?? 0, coverHeight: file.height ?? 0 });
        onClose();
      }}
      onPickPlatform={async () => {
        const picked = await state.pickFromFileManager();
        if (!picked) return;
        onInsert(picked.file);
        onClose();
      }}
      onUpload={onUpload}
      onRefresh={() => void state.loadFileLibrary()}
      onClose={onClose}
    />
  );
}

export function ArticleEditor({ state }: { state: ArticleState }) {
  const t = useMessages(articleMessages);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const document = useRef<HTMLDivElement>(null);
  const visualEditor = useRef<MarkdownVisualEditorHandle>(null);
  const activeEditor = useRef<'source' | 'visual'>('source');
  const history = useRef<EditorHistory>({ values: [], selections: [], index: 0 });
  const restoreRevision = useRef(0);
  const fileInsertion = useRef<[number, number]>([0, 0]);
  const [panelHost, setPanelHost] = useState<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<[number, number]>([0, 0]);
  const [visualSource, setVisualSource] = useState(state.draft?.content ?? '');
  const [visualRestore, setVisualRestore] = useState({ revision: 0, start: 0, end: 0 });
  const [historyButtons, setHistoryButtons] = useState({ canUndo: false, canRedo: false });
  const [filesOpen, setFilesOpen] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const draft = state.draft;
  const hasDraft = !!draft;
  const trashed = !!state.record?.trashedAt;
  const media = useArticleMediaMap(state.files);

  useEffect(() => {
    setFilesOpen(false);
    setCoverPickerOpen(false);
  }, [state.record?.id, hasDraft]);
  const mode = state.editorMode;
  const editorContent = draft?.content;

  useLayoutEffect(() => {
    if (mode === 'edit' && editorContent !== undefined) setVisualSource(editorContent);
  }, [editorContent, mode]);

  useEffect(() => {
    if (history.current.timer) window.clearTimeout(history.current.timer);
    history.current = { values: [state.editorInitialContent], selections: [[0, 0]], index: 0 };
    setSelection([0, 0]);
    setVisualSource(state.editorInitialContent);
    setVisualRestore({ revision: ++restoreRevision.current, start: 0, end: 0 });
    setHistoryButtons({ canUndo: false, canRedo: false });
  }, [state.editorInitialContent, state.editorResetKey]);

  useEffect(() => {
    if (editorContent === undefined) return;
    const current = history.current;
    if (current.values[current.index] === editorContent) return;
    if (current.timer) window.clearTimeout(current.timer);
    setHistoryButtons({ canUndo: true, canRedo: false });
    current.timer = window.setTimeout(() => {
      const live = history.current;
      if (live.values[live.index] === editorContent) return;
      const values = live.values.slice(0, live.index + 1);
      const selections = live.selections.slice(0, live.index + 1);
      values.push(editorContent);
      selections.push(selection);
      if (values.length > 60) values.shift();
      if (selections.length > 60) selections.shift();
      history.current = { values, selections, index: values.length - 1 };
      setHistoryButtons({ canUndo: values.length > 1, canRedo: false });
    }, 350);
    return () => {
      if (current.timer) window.clearTimeout(current.timer);
    };
  }, [editorContent, selection]);

  const requestVisualRestore = useCallback((start: number, end: number) => {
    const revision = restoreRevision.current + 1;
    restoreRevision.current = revision;
    setVisualRestore({ revision, start, end });
  }, []);

  const currentSelection = useCallback(() => {
    if (mode === 'edit' || (mode === 'split' && activeEditor.current === 'source')) {
      const node = textarea.current;
      return {
        value: draft?.content ?? '',
        start: node?.selectionStart ?? selection[0],
        end: node?.selectionEnd ?? selection[1],
      };
    }
    return visualEditor.current?.selection() ?? { value: draft?.content ?? '', start: selection[0], end: selection[1] };
  }, [draft?.content, mode, selection]);

  const updateContent = useCallback(
    (value: string, start: number, end: number, syncPreview = true) => {
      state.setDraft({ content: value });
      setSelection([start, end]);
      if (syncPreview) setVisualSource(value);
    },
    [state],
  );

  const restoreEditorSelection = useCallback(
    (start: number, end: number) => {
      if (mode === 'edit' || (mode === 'split' && activeEditor.current === 'source')) {
        requestAnimationFrame(() => {
          textarea.current?.focus();
          textarea.current?.setSelectionRange(start, end);
        });
      } else requestVisualRestore(start, end);
    },
    [mode, requestVisualRestore],
  );

  const historyMove = (direction: 'undo' | 'redo') => {
    if (!draft) return;
    const current = history.current;
    if (current.timer) window.clearTimeout(current.timer);
    if (current.values[current.index] !== draft.content) {
      const values = current.values.slice(0, current.index + 1);
      const selections = current.selections.slice(0, current.index + 1);
      values.push(draft.content);
      const point = currentSelection();
      selections.push([point.start, point.end]);
      if (values.length > 60) values.shift();
      if (selections.length > 60) selections.shift();
      current.values = values;
      current.selections = selections;
      current.index = values.length - 1;
    }
    const nextIndex = direction === 'undo' ? current.index - 1 : current.index + 1;
    if (nextIndex < 0 || nextIndex >= current.values.length) {
      setHistoryButtons({ canUndo: current.index > 0, canRedo: current.index < current.values.length - 1 });
      return;
    }
    current.index = nextIndex;
    current.timer = undefined;
    const nextValue = current.values[nextIndex]!;
    const nextSelection = current.selections[nextIndex] ?? [nextValue.length, nextValue.length];
    updateContent(nextValue, nextSelection[0], nextSelection[1]);
    setHistoryButtons({ canUndo: current.index > 0, canRedo: current.index < current.values.length - 1 });
    restoreEditorSelection(nextSelection[0], nextSelection[1]);
  };
  const insertAt = (text: string, start: number, end: number) => {
    if (!draft || trashed) return;
    start = Math.max(0, Math.min(draft.content.length, start));
    end = Math.max(start, Math.min(draft.content.length, end));
    const next = `${draft.content.slice(0, start)}${text}${draft.content.slice(end)}`;
    const cursor = start + text.length;
    updateContent(next, cursor, cursor);
    restoreEditorSelection(cursor, cursor);
  };

  const insertFile = (file: ArticleState['files'][number]) => {
    const id = articleFileId(file);
    if (!id || !draft) return;
    const image = file.mediaType.startsWith('image/');
    const label = file.name.replace(/[\[\]\\\r\n]/g, '').trim() || t.editor.fileLabel;
    const insertion = image ? `![${label}](article-file:${id})` : `[${label}](article-file:${id})`;
    const [start, end] = fileInsertion.current;
    const next = `${draft.content.slice(0, start)}${insertion}${draft.content.slice(end)}`;
    const cursor = start + insertion.length;
    state.setDraft({
      content: next,
      ...(!draft.fileIds.includes(id) ? { fileIds: [...draft.fileIds, id] } : {}),
    });
    setSelection([cursor, cursor]);
    setVisualSource(next);
    restoreEditorSelection(cursor, cursor);
  };

  const uploadAndInsert = async (files: readonly File[], insertion?: [number, number]) => {
    if (!draft || files.length === 0) return;
    const current = currentSelection();
    const point = insertion ?? [current.start, current.end];
    const uploaded = await state.uploadFiles(files);
    const markdown = uploaded
      .map((file) => {
        const id = articleFileId(file);
        if (!id) return '';
        const label = file.name.replace(/[\[\]\\\r\n]/g, '').trim() || t.editor.fileLabel;
        return `${file.mediaType.startsWith('image/') ? '!' : ''}[${label}](article-file:${id})`;
      })
      .filter(Boolean)
      .join('\n');
    if (markdown) {
      const text = `${markdown}\n`;
      insertAt(text, point[0], point[1]);
    }
  };

  const format = (value: string) => {
    if (!draft || trashed || state.busy) return;
    const point = currentSelection();
    const result = applyFormat(point.value, point.start, point.end, value, t);
    updateContent(result.value, result.start, result.end);
    restoreEditorSelection(result.start, result.end);
  };

  const [imageBusy, setImageBusy] = useState(false);
  const articleFields = useMemo(
    () => (draft ? articleFormAIFields(draft, state.catalog?.taxonomies ?? []) : {}),
    [draft, state.catalog?.taxonomies],
  );

  const currentContentSelection = useCallback((): ArticleContentImageSelection => {
    const point = currentSelection();
    return {
      source: draft?.content ?? '',
      start: point.start,
      end: point.end,
      caret: point.end,
    };
  }, [currentSelection, draft?.content]);

  const onUseImageFile = useCallback(
    (file: ArticleFile, sel: ArticleContentImageSelection, use: ArticleContentImageUse) => {
      const id = articleFileId(file);
      if (!id || !draft) return false;
      const label = file.name.replace(/[\[\]\\\r\n]/g, '').trim() || t.editor.imageLabel;
      if (use === 'library') {
        state.setStatus(t.editor.savedToLibrary);
        return true;
      }
      const insertion = `![${label}](article-file:${id})\n`;
      if (use === 'replace') {
        const next = `${draft.content.slice(0, sel.start)}${insertion}${draft.content.slice(sel.end)}`;
        const cursor = sel.start + insertion.length;
        updateContent(next, cursor, cursor);
        restoreEditorSelection(cursor, cursor);
      } else {
        const cursor = Math.max(0, Math.min(draft.content.length, sel.caret ?? sel.end));
        const next = `${draft.content.slice(0, cursor)}${insertion}${draft.content.slice(cursor)}`;
        const nextCursor = cursor + insertion.length;
        updateContent(next, nextCursor, nextCursor);
        restoreEditorSelection(nextCursor, nextCursor);
      }
      state.setStatus(t.editor.imageInserted);
      return true;
    },
    [draft, restoreEditorSelection, state, t, updateContent],
  );

  const uploadImageFile = useCallback(
    async (file: File) => {
      const [uploaded] = await state.uploadFiles([file]);
      return uploaded;
    },
    [state],
  );

  if (!draft)
    return (
      <section className="ar-empty-editor">
        <div className="ar-empty-editor-bar">
          <button
            type="button"
            className="ar-panel-toggle-btn"
            data-ar-toggle-library
            title={t.editor.expandLibrary}
            aria-label={t.editor.expandLibrary}
            onClick={() => state.setLibraryCollapsed(false)}
          >
            <Icon className="xyz-icon lucide" name="panel-right-open" />
          </button>
        </div>
        <div className="ar-empty-editor-body">
          <Icon className="xyz-icon lucide" name="file-text" />
          <h2>{t.editor.emptyTitle}</h2>
          <button type="button" className="ar-primary" data-ar-new onClick={() => void state.createDraft()}>
            <Icon className="xyz-icon lucide" name="plus" />
            {t.editor.newArticle}
          </button>
        </div>
      </section>
    );

  const attached = visibleAttachmentFileIDs(draft)
    .map((id) => state.files.find((file) => articleFileId(file) === id))
    .filter(Boolean);
  const isDirty = state.dirty;
  const coverClass =
    draft.coverWidth && draft.coverHeight && draft.coverWidth / draft.coverHeight < 1.45 ? 'is-square' : 'is-banner';
  return (
    <section
      className="ar-editor"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
          event.preventDefault();
          if (isDirty && !state.busy && !trashed) void state.save();
        }
      }}
    >
      <header className="ar-editor-actions">
        <div className="ar-editor-actions-left">
          <div className="ar-panel-toggles" role="group" aria-label={t.editor.panelToggles}>
            <button
              type="button"
              className="ar-panel-toggle-btn"
              data-ar-toggle-library
              aria-pressed={!state.libraryCollapsed}
              title={state.libraryCollapsed ? t.editor.expandLibrary : t.editor.collapseLibrary}
              aria-label={state.libraryCollapsed ? t.editor.expandLibrary : t.editor.collapseLibrary}
              onClick={() => state.setLibraryCollapsed((value) => !value)}
            >
              <Icon className="xyz-icon lucide" name={state.libraryCollapsed ? 'panel-right-open' : 'columns'} />
            </button>
            <button
              type="button"
              className={`ar-panel-toggle-btn ar-focus-toggle${state.libraryCollapsed ? ' is-active' : ''}`}
              data-ar-toggle-focus
              aria-pressed={state.libraryCollapsed}
              title={t.editor.focusMode}
              aria-label={t.editor.focusMode}
              onClick={() => state.setLibraryCollapsed((value) => !value)}
            >
              <Icon className="xyz-icon lucide" name={state.libraryCollapsed ? 'minimize-2' : 'maximize-2'} />
            </button>
          </div>
          <span className="ar-save-state" data-ar-save-state>
            {trashed
              ? t.editor.trashedBadge
              : isDirty
                ? t.editor.unsaved
                : state.record
                  ? t.editor.saved
                  : t.editor.newDraft}
          </span>
        </div>
        <div className="ar-editor-actions-right">
          {state.record && !trashed && (
            <button
              type="button"
              className="ar-danger"
              data-ar-action="trash"
              disabled={state.busy}
              onClick={() => void state.articleAction('trash')}
            >
              <Icon className="xyz-icon lucide" name="trash-2" />
              {t.editor.moveToTrash}
            </button>
          )}
          {state.record?.publishedAt && !trashed && (
            <button
              type="button"
              data-ar-action="unpublish"
              disabled={state.busy}
              onClick={() => void state.articleAction('unpublish')}
            >
              <Icon className="xyz-icon lucide" name="undo-2" />
              {t.editor.unpublish}
            </button>
          )}
          {trashed ? (
            <>
              <button
                type="button"
                data-ar-action="restore"
                disabled={state.busy}
                onClick={() => void state.articleAction('restore')}
              >
                <Icon className="xyz-icon lucide" name="rotate-ccw" />
                {t.editor.restore}
              </button>
              <button
                type="button"
                className="ar-danger"
                data-ar-action="delete"
                disabled={state.busy}
                onClick={() => void state.articleAction('delete')}
              >
                <Icon className="xyz-icon lucide" name="trash-2" />
                {t.editor.deleteForever}
              </button>
            </>
          ) : (
            <>
              <button type="button" data-ar-save disabled={state.busy || !isDirty} onClick={() => void state.save()}>
                <Icon className="xyz-icon lucide" name="save" />
                {t.editor.saveDraft}
              </button>
              <button
                type="button"
                className="ar-primary"
                data-ar-publish
                disabled={state.busy || !isDirty}
                onClick={() => void state.save(true)}
              >
                <Icon className="xyz-icon lucide" name="send" />
                {state.record?.publishedAt ? t.hooks.updatePublish : t.hooks.publishArticle}
              </button>
            </>
          )}
          {!trashed && <ArticleFormAI state={state} />}
        </div>
      </header>
      <div className="ar-document" ref={document}>
        <div className="ar-document-header">
          <div className="ar-header-body">
            <div className="ar-header-main">
              <input
                className="ar-title"
                name="title"
                maxLength={160}
                aria-label={t.editor.titleAria}
                placeholder={t.editor.titlePlaceholder}
                disabled={state.busy || trashed}
                value={draft.title}
                onChange={(event) => state.setDraft({ title: event.currentTarget.value })}
              />
              <div className="ar-summary-wrap">
                <textarea
                  className="ar-summary"
                  name="summary"
                  maxLength={500}
                  rows={2}
                  aria-label={t.editor.summaryAria}
                  placeholder={t.editor.summaryPlaceholder}
                  disabled={state.busy || trashed}
                  value={draft.summary}
                  onChange={(event) => state.setDraft({ summary: event.currentTarget.value })}
                />
              </div>
            </div>
            {draft.coverFileId > 0 && (
              <div className={`ar-editor-cover-banner ${coverClass}`} data-ar-editor-banner>
                <AppImage
                  fileId={draft.coverFileId}
                  alt={t.editor.coverBadge}
                  className="ar-editor-cover-img"
                />
                <span className="ar-editor-cover-badge">
                  <Icon className="xyz-icon lucide" name="image" />
                  {t.editor.coverBadge}
                </span>
                <div className="ar-editor-cover-actions">
                  <button type="button" data-ar-pick-cover onClick={() => setCoverPickerOpen(true)}>
                    {t.editor.change}
                  </button>
                  <button
                    type="button"
                    className="ar-danger"
                    data-ar-remove-cover
                    onClick={() => state.setDraft({ coverFileId: 0, coverWidth: 0, coverHeight: 0 })}
                  >
                    {t.common.remove}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="ar-metadata">
            <ArticleCascader
              value={draft.categoryId}
              taxonomies={state.catalog?.taxonomies ?? []}
              disabled={state.busy || trashed}
              onChange={(categoryId) => state.setDraft({ categoryId })}
            />
            <div className="ar-dropdown-wrap" data-ar-dropdown-wrap="visibility">
              <button
                type="button"
                className="ar-meta-pill ar-dropdown-btn"
                data-ar-dropdown-trigger="visibility"
                disabled={state.busy || trashed}
                onClick={(event) => {
                  const menu = event.currentTarget.nextElementSibling as HTMLElement | null;
                  if (menu) menu.hidden = !menu.hidden;
                }}
              >
                <Icon className="xyz-icon lucide" name={draft.visibility === 'public' ? 'globe' : 'lock'} />
                <span className="ar-dropdown-label">
                  {draft.visibility === 'public' ? t.common.visibility.public : t.common.visibility.private}
                </span>
                <span className="ar-select-chevron">
                  <Icon className="xyz-icon lucide" name="chevron-down" />
                </span>
              </button>
              <div className="ar-dropdown-menu" data-ar-dropdown-menu="visibility" role="listbox" hidden>
                {(['private', 'public'] as const).map((visibility) => (
                  <button
                    key={visibility}
                    type="button"
                    className={`ar-dropdown-item${draft.visibility === visibility ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={draft.visibility === visibility}
                    data-ar-set-visibility={visibility}
                    onClick={() => {
                      state.setDraft({ visibility });
                      const menu = document.current?.querySelector<HTMLElement>('[data-ar-dropdown-menu="visibility"]');
                      if (menu) menu.hidden = true;
                    }}
                  >
                    <Icon className="xyz-icon lucide" name={visibility === 'public' ? 'globe' : 'lock'} />
                    {visibility === 'public' ? t.common.visibility.public : t.common.visibility.private}
                  </button>
                ))}
              </div>
            </div>
            <Cover state={state} disabled={state.busy || trashed} onOpen={() => setCoverPickerOpen(true)} />
            <ArticleTagEditor
              draft={draft}
              taxonomies={state.catalog?.taxonomies ?? []}
              disabled={state.busy || trashed}
              onChange={(tagIds) => state.setDraft({ tagIds })}
              onCreate={async (name) => {
                const result = await state.mutateTaxonomy({
                  id: 0,
                  kind: 'tag',
                  name,
                  parentId: 0,
                  revision: 0,
                  action: 'save',
                });
                const entry = result.taxonomy;
                if (entry?.kind === 'tag') state.setDraft({ tagIds: [...new Set([...draft.tagIds, entry.id])] });
              }}
            />
          </div>
        </div>
        <div className="ar-writing-toolbar md-editor-toolbar" role="group" aria-label={t.editor.toolbarGroup}>
          <div className="ar-toolbar-modes md-editor-modes" role="group" aria-label={t.editor.modeGroup}>
            {(
              [
                ['edit', t.editor.modes.edit],
                ['split', t.editor.modes.split],
                ['preview', t.editor.modes.preview],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                data-ar-mode={value}
                aria-pressed={mode === value}
                onClick={() => state.setEditorMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ar-toolbar-tools md-editor-tools" role="group" aria-label={t.editor.formatGroup}>
            <div className="md-editor-tool-group">
              <button
                type="button"
                data-ar-history="undo"
                aria-label={t.editor.undo}
                title={t.editor.undo}
                disabled={!historyButtons.canUndo || state.busy || trashed}
                onClick={() => historyMove('undo')}
              >
                <Icon className="xyz-icon lucide" name="undo-2" />
              </button>
              <button
                type="button"
                data-ar-history="redo"
                aria-label={t.editor.redo}
                title={t.editor.redo}
                disabled={!historyButtons.canRedo || state.busy || trashed}
                onClick={() => historyMove('redo')}
              >
                <Icon className="xyz-icon lucide" name="redo-2" />
              </button>
            </div>
            <div className="md-editor-tool-group">
              {formatItems.map(([formatName, iconName]) => {
                const label = t.editor.formatLabels[formatName];
                return (
                  <button
                    type="button"
                    key={formatName}
                    data-ar-format={formatName}
                    aria-label={label}
                    title={label}
                    disabled={state.busy || trashed}
                    onClick={() => format(formatName)}
                  >
                    <Icon className="xyz-icon lucide" name={iconName} />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              data-ar-files
              aria-expanded={filesOpen}
              onClick={() => {
                if (!filesOpen) {
                  const point = currentSelection();
                  fileInsertion.current = [point.start, point.end];
                  void state.loadFileLibrary();
                }
                setFilesOpen((open) => !open);
              }}
            >
              <Icon className="xyz-icon lucide" name="paperclip" />
              <span>{t.editor.attachments}</span>
            </button>
            {!trashed && (
              <>
                <TextAIEditor
                  editor={textarea}
                  value={draft.content}
                  onChange={(content) => {
                    const point = currentSelection();
                    updateContent(content, point.start, point.end);
                  }}
                  disabled={state.busy || imageBusy}
                  permission="article-management"
                  target="article.form"
                  field="content"
                  identity={{ recordId: state.record?.id ?? 0, revision: state.record?.revision ?? 0 }}
                  referenceValues={{ title: draft.title, summary: draft.summary }}
                  maxLength={80000}
                  quickActions={false}
                  entryLabel={t.editor.aiEntry}
                  dialogLabel={t.editor.aiDialog}
                  contentLabel={t.editor.aiContent}
                  applyLabel={t.editor.aiApply}
                />
                <ArticleContentImageAI
                  active={state.allowed && !state.busy}
                  identity={{ recordId: state.record?.id ?? 0, revision: state.record?.revision ?? 0 }}
                  fields={articleFields}
                  selection={currentContentSelection}
                  onUseFile={onUseImageFile}
                  onStatus={state.setStatus}
                  onBusyChange={setImageBusy}
                  uploadFile={uploadImageFile}
                />
              </>
            )}
          </div>
        </div>
        <div data-ar-file-panel ref={setPanelHost}>
          <FilePanel
            state={state}
            open={filesOpen}
            onInsert={insertFile}
            onUpload={(files) => {
              setFilesOpen(false);
              void uploadAndInsert(files, fileInsertion.current);
            }}
            onClose={() => setFilesOpen(false)}
          />
        </div>
        <div className={`ar-writing md-editor-writing is-${mode}`}>
          <textarea
            ref={textarea}
            name="content"
            data-ar-content
            aria-label={t.editor.contentAria}
            placeholder={t.editor.writePlaceholder}
            maxLength={80000}
            spellCheck={false}
            disabled={state.busy || trashed}
            value={draft.content}
            onFocus={() => {
              activeEditor.current = 'source';
            }}
            onSelect={(event) => {
              activeEditor.current = 'source';
              setSelection([event.currentTarget.selectionStart, event.currentTarget.selectionEnd]);
            }}
            onChange={(event) => {
              const { value, selectionStart, selectionEnd } = event.currentTarget;
              updateContent(value, selectionStart, selectionEnd);
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (!files.length) return;
              event.preventDefault();
              void uploadAndInsert(files, [event.currentTarget.selectionStart, event.currentTarget.selectionEnd]);
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.files.length) event.preventDefault();
            }}
            onDrop={(event) => {
              const files = Array.from(event.dataTransfer.files);
              if (!files.length) return;
              event.preventDefault();
              void uploadAndInsert(files, [event.currentTarget.selectionStart, event.currentTarget.selectionEnd]);
            }}
            onKeyDown={(event) => {
              if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'z') return;
              event.preventDefault();
              historyMove(event.shiftKey ? 'redo' : 'undo');
            }}
          />
          <MarkdownVisualEditor
            ref={visualEditor}
            id="articleContentPreview"
            className="ar-preview xyz-markdown"
            dataAttributes={{ 'data-ar-preview': '' }}
            editableLabel={t.editor.previewEditLabel}
            readonlyLabel={t.editor.previewLabel}
            placeholder={t.editor.writePlaceholder}
            maxLength={80_000}
            maxLengthMessage={t.editor.maxLengthMessage}
            renderSource={visualSource}
            value={draft.content}
            media={media}
            mode={mode}
            editable={!trashed}
            busy={state.busy}
            selection={selection}
            restore={visualRestore}
            panelHost={panelHost}
            onChange={updateContent}
            onSelection={(start, end) => {
              activeEditor.current = 'visual';
              setSelection([start, end]);
            }}
            onUploadFiles={(files, start, end) => void uploadAndInsert(files, [start, end])}
            onHistory={(direction) => historyMove(direction === -1 ? 'undo' : 'redo')}
            onFormat={format}
            onError={state.setError}
          />
        </div>
        <div className="ar-attachments md-editor-attachments" data-ar-attachments>
          {attached.map(
            (file) =>
              file && (
                <div key={file.id}>
                  <span>
                    <Icon className="xyz-icon lucide" name="file" />
                    <a
                      href={`#file-${articleFileId(file) ?? 0}`}
                      onClick={(event) => {
                        event.preventDefault();
                        const id = articleFileId(file);
                        if (id) void downloadBackendFile(id, file.name);
                      }}
                    >
                      {file.name}
                    </a>
                  </span>
                  <button
                    type="button"
                    aria-label={t.editor.removeAttachment(file.name)}
                    onClick={() => {
                      const id = articleFileId(file);
                      if (id) state.setDraft({ fileIds: draft.fileIds.filter((value) => value !== id) });
                    }}
                  >
                    <Icon className="xyz-icon lucide" name="x" />
                  </button>
                </div>
              ),
          )}
        </div>
      </div>
      <footer className="ar-editor-footer">
        <span>{t.editor.charCount(draft.content.length.toLocaleString(currentLocale()))}</span>
      </footer>
      <ArticleCoverPicker
        state={state}
        open={coverPickerOpen}
        onClose={() => setCoverPickerOpen(false)}
        onApply={(coverFileId, coverWidth, coverHeight) => state.setDraft({ coverFileId, coverWidth, coverHeight })}
      />
    </section>
  );
}
