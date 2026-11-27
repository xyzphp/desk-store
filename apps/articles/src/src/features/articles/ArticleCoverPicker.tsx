import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Select, AnchorPopover,
  Button,
  Checkbox,
  HelpTip,
  ImageCropper,
  Icon,
  WindowTitlebar,
  useMessages,
  type ImageCropResult, } from '@xyzos/desk-ui';
import { useHost, useSession } from '../../host/HostProvider';
import { generateAIImage } from '../../shared/ai/generatedImage';
import { isAbort } from '../../shared/hooks/useRequest';
import { cropCoverImage } from '../../shared/files/imageProcessing';
import { AppImage } from '../../shared/sdk/media';
import { articleFileId, type ArticleFile } from './api';
import { categoryPath } from './model';
import {
  articleCoverSpecs,
  articleImageAvailable,
  articleImageQualityKeys,
  articleImageSnapshotKey,
  createArticleCoverRequest,
  defaultArticleImageReferences,
  readArticleImageCapability,
  type ArticleCoverFormat,
  type ArticleImageCapability,
  type ArticleImageQuality,
  type ArticleImageSnapshot,
} from './articleImageAI';
import type { useArticles } from './useArticles';
import { AIModelPicker } from '../../shared/ai/AIModelPicker';
import { rangeFill } from '../../shared/ai/rangeFill';
import { AIPanelResizers, useAIPanelGesture } from '../../shared/ai/useAIPanelGesture';
import { articleMessages, type ArticleMessages } from './locale';

type ArticleState = ReturnType<typeof useArticles>;
type CoverFormat = ArticleCoverFormat;
interface ArticleImageContext {
  authorized: boolean;
  generation: number;
  recordId: number;
  revision: number;
  sourceKey: string;
}
interface GeneratedCover {
  blob: Blob;
  url: string;
  format: CoverFormat;
  context: ArticleImageContext;
  saved?: ArticleFile;
}
const formats = {
  banner: { ...articleCoverSpecs.banner, ratio: '2.35:1' },
  square: { ...articleCoverSpecs.square, ratio: '1:1' },
} satisfies Record<CoverFormat, { width: number; height: number; ratio: string; generationSize: string }>;

function articleImageValues(state: ArticleState, t: ArticleMessages): ArticleImageSnapshot {
  const draft = state.draft;
  const taxonomies = state.catalog?.taxonomies ?? [];
  return {
    title: draft?.title ?? '',
    summary: draft?.summary ?? '',
    content: draft?.content ?? '',
    category:
      categoryPath(
        taxonomies.find((item) => item.id === draft?.categoryId && item.kind === 'category'),
        taxonomies,
      ) || t.common.uncategorized,
    tags: (draft?.tagIds ?? [])
      .map((id) => taxonomies.find((item) => item.id === id && item.kind === 'tag')?.name ?? '')
      .filter(Boolean)
      .join('\n'),
    visibility: draft?.visibility === 'public' ? t.common.visibility.public : t.common.visibility.private,
  };
}

function sameImageContext(left: ArticleImageContext, right: ArticleImageContext) {
  return (
    left.authorized === right.authorized &&
    left.generation === right.generation &&
    left.recordId === right.recordId &&
    left.revision === right.revision &&
    left.sourceKey === right.sourceKey
  );
}

export function ArticleCoverPicker({
  state,
  open,
  onClose,
  onApply,
}: {
  state: ArticleState;
  open: boolean;
  onClose: () => void;
  onApply: (id: number, width: number, height: number) => void;
}) {
  const host = useHost();
  const session = useSession();
  const t = useMessages(articleMessages);
  const gesture = useAIPanelGesture();
  const imagePanelId = useId();
  const qualityId = useId();
  const qualityAnchor = useRef<HTMLButtonElement>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const { loadFileLibrary, setError } = state;
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'upload' | 'library'>('library');
  const [format, setFormat] = useState<CoverFormat>('banner');
  const [source, setSource] = useState<Blob | null>(null);
  const [sourceName, setSourceName] = useState('cover.jpg');
  const [files, setFiles] = useState<ArticleFile[]>([]);
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState(40);
  const [loading, setLoading] = useState(false);
  const [dragover, setDragover] = useState(false);
  const [imageCapability, setImageCapability] = useState<ArticleImageCapability>();
  const [imageModel, setImageModel] = useState('');
  const [imageQuality, setImageQuality] = useState<ArticleImageQuality>('auto');
  const [imageReferences, setImageReferences] = useState<string[]>([]);
  const [imageInstruction, setImageInstruction] = useState('');
  const [imageUse, setImageUse] = useState<'cover' | 'library'>('cover');
  const [imageError, setImageError] = useState('');
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imagePanelOpen, setImagePanelOpen] = useState(false);
  const imageAnchor = useRef<HTMLElement | null>(null);
  const [generatedCover, setGeneratedCover] = useState<GeneratedCover>();
  const operation = useRef<{ controller: AbortController; context: ArticleImageContext } | null>(null);
  const generatedRef = useRef<GeneratedCover | undefined>(undefined);
  const values = articleImageValues(state, t);
  const hasCurrentDraft = !!state.draft;
  const recordIsTrashed = !!state.record?.trashedAt;
  const sourceKey = articleImageSnapshotKey(values);
  const currentContext = useMemo<ArticleImageContext>(
    () => ({
      authorized: session.status === 'ready' && state.allowed && hasCurrentDraft && !recordIsTrashed,
      generation: session.generation,
      recordId: state.record?.id ?? 0,
      revision: state.record?.revision ?? 0,
      sourceKey,
    }),
    [
      session.status,
      state.allowed,
      hasCurrentDraft,
      recordIsTrashed,
      session.generation,
      state.record?.id,
      state.record?.revision,
      sourceKey,
    ],
  );
  const contextRef = useRef(currentContext);
  const target = formats[format];
  const selectedCover = files.find((file) => articleFileId(file) === state.draft?.coverFileId);

  const clearGeneratedCover = useCallback(() => {
    if (generatedRef.current) URL.revokeObjectURL(generatedRef.current.url);
    generatedRef.current = undefined;
    setGeneratedCover(undefined);
  }, []);

  const stopGeneration = useCallback((message = '') => {
    operation.current?.controller.abort();
    operation.current = null;
    setImageGenerating(false);
    if (message) setImageError(message);
  }, []);
  const closeImageAI = useCallback(() => {
    stopGeneration();
    clearGeneratedCover();
    setImagePanelOpen(false);
    setQualityOpen(false);
    imageAnchor.current = null;
    setImageInstruction('');
    setImageQuality('auto');
    setImageUse('cover');
    const model =
      imageCapability?.models.find((item) => item.id === imageCapability.defaultModelId && item.imageEnabled) ??
      imageCapability?.models.find((item) => item.imageEnabled);
    setImageModel(model?.id ?? '');
    setImageReferences(imageCapability ? defaultArticleImageReferences(imageCapability) : []);
  }, [clearGeneratedCover, stopGeneration, imageCapability]);

  useEffect(() => {
    const previousContext = contextRef.current;
    contextRef.current = currentContext;
    if (operation.current && !sameImageContext(operation.current.context, currentContext)) {
      stopGeneration(t.cover.contentChangedStopped);
    }
    if (generatedRef.current && !sameImageContext(generatedRef.current.context, currentContext)) {
      clearGeneratedCover();
      setImageError(t.cover.contentChangedCleared);
    }
    if (
      imagePanelOpen &&
      (!currentContext.authorized ||
        previousContext.recordId !== currentContext.recordId ||
        previousContext.revision !== currentContext.revision ||
        previousContext.sourceKey !== currentContext.sourceKey)
    ) {
      setImagePanelOpen(false);
      imageAnchor.current = null;
      setImageInstruction('');
      setImageQuality('auto');
      setImageUse('cover');
    }
  }, [
    imagePanelOpen,
    currentContext,
    clearGeneratedCover,
    stopGeneration,
    t.cover.contentChangedCleared,
    t.cover.contentChangedStopped,
  ]);

  useEffect(() => {
    if (!open) return;
    const width = selectedCover?.width || state.draft?.coverWidth || 0;
    const height = selectedCover?.height || state.draft?.coverHeight || 0;
    setFormat(width && height && width / height < 1.45 ? 'square' : 'banner');
  }, [open, selectedCover?.width, selectedCover?.height, state.draft?.coverWidth, state.draft?.coverHeight]);

  useEffect(() => {
    const node = dialog.current;
    if (!open || !node) {
      setSource(null);
      return;
    }
    setSource(null);
    // 先从素材库里挑，没有合适的再切到“上传并裁剪”。
    setTab('library');
    setQuery('');
    setPageSize(40);
    setImageError('');
    setImageInstruction('');
    setImageUse('cover');
    setImageQuality('auto');
    setImageCapability(undefined);
    clearGeneratedCover();
    const controller = new AbortController();
    void loadFileLibrary()
      .then((items) => setFiles(items.filter((file) => /^image\/(png|jpeg|webp)$/i.test(file.mediaType))))
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : t.cover.readFailed));
    if (state.allowed && hasCurrentDraft && !recordIsTrashed) {
      void readArticleImageCapability(
        host,
        { recordId: state.record?.id ?? 0, revision: state.record?.revision ?? 0 },
        controller.signal,
      )
        .then((capability) => {
          if (controller.signal.aborted) return;
          setImageCapability(capability);
          const defaultModel =
            capability.models.find((model) => model.id === capability.defaultModelId && model.imageEnabled) ??
            capability.models.find((model) => model.imageEnabled);
          setImageModel(defaultModel?.id ?? '');
          setImageReferences(defaultArticleImageReferences(capability));
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted && !isAbort(failure)) setImageError(t.cover.configFailed);
        });
    }
    if (!node.open) node.showModal();
    return () => {
      controller.abort();
      stopGeneration();
      clearGeneratedCover();
      if (node.open) node.close();
    };
  }, [
    open,
    loadFileLibrary,
    setError,
    clearGeneratedCover,
    stopGeneration,
    host,
    state.allowed,
    hasCurrentDraft,
    recordIsTrashed,
    state.record?.id,
    state.record?.revision,
    t.cover.configFailed,
    t.cover.readFailed,
  ]);

  const closePicker = () => {
    closeImageAI();
    setSource(null);
    onClose();
  };

  const selectSource = (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      state.setError(t.cover.typeUnsupported);
      return;
    }
    setSource(file);
    setSourceName(file.name || 'cover.jpg');
    setTab('upload');
    closeImageAI();
    state.setError('');
  };

  const selectLibraryFile = async (file: ArticleFile) => {
    const id = articleFileId(file);
    if (!id) return;
    setLoading(true);
    try {
      const blob = await host.readBlob(`/files/content/${id}`, {
        fallbackError: t.cover.readFailed,
      });
      setSource(blob);
      setSourceName(file.name);
      selectTab('upload');
      state.setError('');
    } catch (failure) {
      state.setError(failure instanceof Error ? failure.message : t.cover.readFailed);
    } finally {
      setLoading(false);
    }
  };

  const pickPlatformCover = async () => {
    if (loading || state.busy || imageGenerating) return;
    setLoading(true);
    try {
      const picked = await state.pickFromFileManager({ attachToDraft: false, imagesOnly: true });
      if (!picked) return;
      setFiles((current) => [picked.file, ...current.filter((item) => item.id !== picked.file.id)]);
      if (picked.tempUrl) {
        const res = await fetch(picked.tempUrl);
        if (res.ok) {
          const blob = await res.blob();
          setSource(blob);
          setSourceName(picked.file.name);
          selectTab('upload');
          state.setError('');
          return;
        }
      }
      await selectLibraryFile(picked.file);
    } catch (failure) {
      state.setError(failure instanceof Error ? failure.message : t.cover.readFailed);
    } finally {
      setLoading(false);
    }
  };

  const selectTab = (next: typeof tab) => {
    closeImageAI();
    setImageError('');
    setTab(next);
  };

  const generateCover = async () => {
    if (imageGenerating || !state.allowed || !state.draft || recordIsTrashed) return;
    const context = contextRef.current;
    if (!context.authorized) {
      setImageError(t.cover.notEditable);
      return;
    }
    const pending = { controller: new AbortController(), context };
    operation.current = pending;
    setImageGenerating(true);
    setImageError('');
    clearGeneratedCover();
    const isCurrent = () =>
      operation.current === pending &&
      !pending.controller.signal.aborted &&
      sameImageContext(contextRef.current, context);
    try {
      const identity = { recordId: context.recordId, revision: context.revision };
      const latest = await readArticleImageCapability(host, identity, pending.controller.signal);
      if (!isCurrent()) return;
      if (!articleImageAvailable(latest)) throw new Error(t.imageAI.unavailable);
      const model =
        latest.models.find((item) => item.id === imageModel && item.imageEnabled) ??
        latest.models.find((item) => item.id === latest.defaultModelId && item.imageEnabled);
      if (!model) throw new Error(t.cover.noModel);
      const request = createArticleCoverRequest(
        host,
        latest,
        identity,
        format,
        model.id,
        imageQuality,
        imageInstruction,
        imageReferences,
        values,
      );
      const generated = await generateAIImage(host, request, pending.controller.signal);
      if (!isCurrent()) return;
      const spec = formats[format];
      const blob = await cropCoverImage(generated, spec, pending.controller.signal);
      if (!isCurrent()) return;
      const result = { blob, url: URL.createObjectURL(blob), format, context };
      generatedRef.current = result;
      setGeneratedCover(result);
      setImageCapability(latest);
      setImageModel(model.id);
    } catch (failure) {
      if (isCurrent() && !isAbort(failure))
        setImageError(failure instanceof Error ? failure.message : t.cover.generateFailed);
    } finally {
      if (operation.current === pending) {
        operation.current = null;
        setImageGenerating(false);
      }
    }
  };

  const uploadGeneratedCover = async () => {
    const generated = generatedRef.current;
    if (!generated || loading || state.busy) return;
    if (!sameImageContext(generated.context, contextRef.current) || generated.format !== format) {
      setImageError(t.cover.specChanged);
      clearGeneratedCover();
      return;
    }
    const spec = formats[generated.format];
    let saved = generated.saved;
    try {
      if (!saved) {
        const file = new File([generated.blob], `cover_${spec.width}x${spec.height}.png`, { type: 'image/png' });
        setLoading(true);
        setImageError('');
        const [uploaded] = await state.uploadFiles([file], { preserveImage: true, attachToDraft: false });
        if (!uploaded || !articleFileId(uploaded)) return;
        saved = uploaded;
        const next = { ...generated, saved };
        generatedRef.current = next;
        setGeneratedCover(next);
        setFiles((current) => [...current.filter((item) => item.id !== uploaded.id), uploaded]);
      }
      if (imageUse === 'library') {
        state.setStatus(t.cover.savedPrivate);
        return;
      }
      const id = saved ? articleFileId(saved) : undefined;
      if (!id) throw new Error(t.cover.uploadedIdInvalid);
      if (!sameImageContext(generated.context, contextRef.current)) {
        state.setError(t.cover.savedButNotSet);
        return;
      }
      onApply(id, spec.width, spec.height);
      state.setStatus(t.cover.coverSet);
      closePicker();
    } catch (failure) {
      if (!isAbort(failure)) setImageError(failure instanceof Error ? failure.message : t.cover.uploadFailed);
    } finally {
      setLoading(false);
    }
  };

  const applyCrop = async (result: ImageCropResult) => {
    if (state.busy) return;
    setLoading(true);
    const ext = sourceName.toLocaleLowerCase().endsWith('.png') ? 'png' : 'jpg';
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    const file = new File([result.blob], `cover_${target.width}x${target.height}.${ext}`, { type: mime });
    try {
      const [uploaded] = await state.uploadFiles([file]);
      const id = uploaded ? articleFileId(uploaded) : undefined;
      if (!id) return;
      onApply(id, target.width, target.height);
      closePicker();
    } finally {
      setLoading(false);
    }
  };

  const matchingFiles = files.filter((file) => file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const visibleFiles = matchingFiles.slice(0, pageSize);
  const remainingFiles = matchingFiles.length - visibleFiles.length;
  const canGenerateCover = articleImageAvailable(imageCapability) && currentContext.authorized;
  const qualityIndex = articleImageQualityKeys.findIndex((value) => value === imageQuality);
  return (
    <dialog
      ref={dialog}
      className="ar-modal ar-cover-dialog workspace-app"
      aria-label={t.cover.dialogAria}
      onCancel={(event) => {
        event.preventDefault();
        if (loading || state.busy) return;
        closePicker();
      }}
    >
      <header className="window-dialog-head">
        <h2>{t.cover.dialogTitle}</h2>
        <div className="traffic window-controls" role="group" aria-label={t.cover.windowControls}>
          <button
            type="button"
            className="t-close"
            data-window-action="close"
            data-ar-close-modal=""
            title={t.cover.closeWindow}
            aria-label={t.cover.closeWindow}
            disabled={loading || state.busy}
            onClick={closePicker}
          >
            <Icon className="xyz-icon" name="x" strokeWidth={2} />
          </button>
        </div>
      </header>
      <div className="ar-cover-modal">
        <div className="workspace-toolbar-actions ar-cover-tabs" role="group" aria-label={t.cover.sourceGroup}>
          <button
            type="button"
            className="workspace-button"
            data-ar-cover-tab="library"
            aria-pressed={tab === 'library'}
            disabled={loading || state.busy || imageGenerating}
            onClick={async () => {
              selectTab('library');
              try {
                setFiles(
                  (await state.loadFileLibrary()).filter((file) => /^image\/(png|jpeg|webp)$/i.test(file.mediaType)),
                );
              } catch (failure) {
                state.setError(failure instanceof Error ? failure.message : t.cover.readFailed);
              }
            }}
          >
            <Icon className="xyz-icon" name="folder-open" strokeWidth={2} />
            <span>{t.cover.libraryTab}</span>
            <span className="workspace-count">{files.length}</span>
          </button>
          <button
            type="button"
            className="workspace-button"
            data-ar-cover-tab="upload"
            aria-pressed={tab === 'upload'}
            disabled={loading || state.busy || imageGenerating}
            onClick={() => selectTab('upload')}
          >
            <Icon className="xyz-icon" name="crop" strokeWidth={2} />
            <span>{t.cover.uploadTab}</span>
          </button>
          {canGenerateCover && (
            <button
              type="button"
              className="workspace-button"
              data-ar-cover-generate
              aria-haspopup="dialog"
              aria-expanded={imagePanelOpen}
              aria-controls={imagePanelId}
              disabled={loading || state.busy || imageGenerating}
              onClick={(event) => {
                imageAnchor.current = event.currentTarget;
                setImagePanelOpen(true);
              }}
            >
              <Icon className="xyz-icon" name="image-plus" strokeWidth={2} />
              <span>{t.cover.generateTab}</span>
            </button>
          )}
        </div>
        {tab === 'upload' && (
          <div className="ar-cover-panel" data-ar-cover-panel="upload">
            <div className="ar-crop-format-selector" role="group" aria-label={t.cover.formatGroup}>
              {(Object.entries(formats) as [CoverFormat, (typeof formats)[CoverFormat]][]).map(([key, entry]) => (
                <button
                  type="button"
                  className="workspace-button ar-crop-format-card"
                  data-ar-format={key}
                  key={key}
                  aria-pressed={format === key}
                  disabled={loading || state.busy || imageGenerating}
                  onClick={() => {
                    if (format === key) return;
                    clearGeneratedCover();
                    setFormat(key);
                  }}
                >
                  <span className="ar-crop-format-header">
                    <Icon className="xyz-icon" name="image" strokeWidth={2} />
                    <strong className="ar-crop-format-title">{t.cover.formats[key].label}</strong>
                    <span className="ar-crop-format-check" aria-hidden="true">
                      <Icon className="xyz-icon" name="check" strokeWidth={2} />
                    </span>
                  </span>
                  <span className="ar-crop-format-size">
                    {entry.ratio} · {entry.width} × {entry.height} px
                  </span>
                  <span className="ar-crop-format-desc">{t.cover.formats[key].description}</span>
                </button>
              ))}
            </div>
            <div data-ar-crop-body>
              {!source ? (
                <div
                  className={`workspace-button ar-crop-dropzone${dragover ? ' is-dragover' : ''}`}
                  data-ar-dropzone
                  tabIndex={0}
                  role="button"
                  aria-label={t.cover.dropzoneAria}
                  onClick={(event) => {
                    if (event.target !== fileInput.current) fileInput.current?.click();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    fileInput.current?.click();
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragover(true);
                  }}
                  onDragLeave={() => setDragover(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragover(false);
                    const file = event.dataTransfer.files[0];
                    if (file) selectSource(file);
                  }}
                >
                  <Icon className="xyz-icon" name="upload" strokeWidth={2} />
                  <strong>{t.cover.dropzoneTitle}</strong>
                  <p>{t.cover.dropzoneTypes}</p>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    data-ar-crop-file-input
                    hidden
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (file) selectSource(file);
                    }}
                  />
                </div>
              ) : (
                <ImageCropper
                  key={`${sourceName}:${target.width}`}
                  nativeStructure
                  label={t.cover.cropLabel}
                  source={source}
                  outputSize={{ width: target.width, height: target.height }}
                  mimeType={sourceName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'}
                  quality={0.92}
                  disabled={loading || state.busy}
                  onCancel={() => setSource(null)}
                  onConfirm={(result) => void applyCrop(result)}
                  labels={{
                    confirm: t.cover.cropConfirm,
                    cancel: t.cover.cropCancel,
                    dimensions: (width, height) =>
                      t.cover.dimensions(t.cover.formats[format].label, formats[format].ratio, width, height),
                  }}
                />
              )}
            </div>
          </div>
        )}
        {tab === 'library' && (
          <div className="ar-cover-panel" data-ar-cover-panel="library">
            <div className="ar-file-tools">
              <input
                type="search"
                className="workspace-field ar-modal-search"
                data-ar-cover-search
                placeholder={t.cover.searchPlaceholder}
                aria-label={t.cover.searchAria}
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setPageSize(40);
                }}
              />
            </div>
            <p className="ar-cover-upload-hint">
              {t.cover.noFitImage}
              <button
                type="button"
                className="workspace-button"
                data-ar-cover-pick-platform
                disabled={loading || state.busy || imageGenerating}
                onClick={() => void pickPlatformCover()}
              >
                <Icon className="xyz-icon" name="folder-open" strokeWidth={2} />
                <span>从文件管理选择</span>
              </button>
              <button
                type="button"
                className="workspace-button"
                data-ar-cover-to-upload
                onClick={() => selectTab('upload')}
              >
                <Icon className="xyz-icon" name="upload" strokeWidth={2} />
                <span>{t.cover.uploadNew}</span>
              </button>
            </p>
            <div className="ar-cover-grid" data-ar-cover-grid>
              {visibleFiles.length ? (
                visibleFiles.map((file) => {
                  const id = articleFileId(file);
                  return id ? (
                    <div
                      key={file.id}
                      className={`ar-cover-option${id === state.draft?.coverFileId ? ' is-selected' : ''}`}
                      title={file.name}
                    >
                      <AppImage fileId={id} alt={file.name} loading="lazy" />
                      <span>{file.name}</span>
                      <div className="ar-cover-option-actions">
                        <button
                          type="button"
                          className="workspace-button is-primary"
                          disabled={loading || state.busy}
                          onClick={() => {
                            onApply(id, file.width ?? 0, file.height ?? 0);
                            closePicker();
                          }}
                        >
                          {t.cover.setCover}
                        </button>
                        <button
                          type="button"
                          className="workspace-button"
                          disabled={loading || state.busy}
                          onClick={() => void selectLibraryFile(file)}
                        >
                          {t.cover.cropCurrent}
                        </button>
                      </div>
                    </div>
                  ) : null;
                })
              ) : (
                <p className="ar-cover-empty">{t.cover.noImages}</p>
              )}
              {remainingFiles > 0 && (
                <div className="ar-cover-load-more-wrap">
                  <button type="button" className="workspace-button" onClick={() => setPageSize((size) => size + 40)}>
                    {t.cover.loadMore(remainingFiles)}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <AnchorPopover
        as="section"
        id={imagePanelId}
        open={imagePanelOpen}
        anchor={imageAnchor}
        role="dialog"
        aria-label={t.cover.generateTitle}
        aria-busy={imageGenerating}
        className="desk-form-ai-layer desk-article-cover-ai-layer ai-assist-popover workspace-app workspace-scrollbars"
        {...gesture.panelProps}
        placement="bottom-start"
        gap={8}
        dismissOnFocusOutside={false}
        onClose={closeImageAI}
      >
        <WindowTitlebar
          as="header"
          className="win-titlebar ai-assist-head"
          title={t.cover.generateTitle}
          {...gesture.handleProps}
          controls={['close']}
          onClose={closeImageAI}
        />
        <div className="ai-assist-body">
          <div className="ai-assist-cover-size" data-ai-cover-size>
            <span>{t.cover.sizeLabel}</span>
            <strong>
              {target.width}×{target.height} px
            </strong>
            <Button
              type="button"
              disabled={imageGenerating}
              onClick={() => {
                closeImageAI();
                setTab('upload');
              }}
            >
              {t.cover.changeSpec}
            </Button>
          </div>
          <section className="ai-assist-preview ai-assist-cover-preview" aria-label={t.cover.previewTitle}>
            <header className="workspace-field-heading">
              <strong>{t.cover.previewTitle}</strong>
            </header>
            {imageGenerating ? (
              <div className="workspace-field ai-assist-pending" role="status">
                <div className="ai-assist-progress" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <span>{t.cover.generating}</span>
              </div>
            ) : generatedCover ? (
              <div className="ai-assist-image-preview">
                <img src={generatedCover.url} alt={t.cover.previewAlt} />
              </div>
            ) : (
              <div className="workspace-field ai-assist-pending">{t.common.pendingImage}</div>
            )}
          </section>
          {imageError && (
            <p className="ai-assist-feedback is-error" role="alert">
              {imageError}
            </p>
          )}
        </div>
        <footer className="ai-assist-bottom">
          <div className="workspace-field workspace-composer" role="group" aria-label={t.common.generateRequirements}>
            <section className="ai-assist-options" aria-label={t.common.referenceSection}>
              <div className="ai-assist-reference-list" role="group" aria-label={t.common.referenceSection}>
                <span className="ai-assist-reference-heading">
                  {t.common.referenceHeading}
                  <HelpTip text={t.common.referenceHelp} />
                </span>
                {(imageCapability?.contextFields ?? [])
                  .map((id) => ({ id, field: imageCapability?.fields.find((item) => item.id === id) }))
                  .filter(({ id, field }) => !!field && !!values[id as keyof ArticleImageSnapshot]?.trim())
                  .map(({ id, field }) => (
                    <div className="workspace-tag ai-assist-reference-row" key={id}>
                      <Checkbox
                        className="workspace-toggle"
                        checked={imageReferences.includes(id)}
                        disabled={imageGenerating || loading || state.busy}
                        aria-label={t.common.referenceAs(field?.name ?? '')}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setImageReferences((current) =>
                            checked ? [...new Set([...current, id])] : current.filter((item) => item !== id),
                          );
                          clearGeneratedCover();
                        }}
                      >
                        {field?.name}
                      </Checkbox>
                    </div>
                  ))}
              </div>
            </section>
            <textarea
              className="workspace-composer-instruction"
              rows={1}
              maxLength={4000}
              value={imageInstruction}
              placeholder={t.cover.instructionPlaceholder}
              aria-label={t.cover.instructionAria}
              disabled={imageGenerating || loading || state.busy}
              onChange={(event) => {
                setImageInstruction(event.currentTarget.value);
                clearGeneratedCover();
              }}
            />
            <div className="workspace-composer-controls">
              <Button
                ref={qualityAnchor}
                type="button"
                variant="quiet"
                className="workspace-composer-choice"
                icon="sliders-horizontal"
                aria-label={t.common.sizeAndQuality}
                aria-haspopup="dialog"
                aria-expanded={qualityOpen}
                aria-controls={qualityOpen ? qualityId : undefined}
                disabled={imageGenerating || loading || state.busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setQualityOpen((value) => !value)}
              >
                <span className="workspace-composer-meta" data-ai-image-summary>
                  {formats[format].width}×{formats[format].height} px ·{' '}
                  {qualityIndex <= 0
                    ? t.cover.autoQuality
                    : t.imageAI.qualities[articleImageQualityKeys[qualityIndex] ?? 'auto']}
                </span>
                <Icon name="chevron-down" />
              </Button>
            </div>
            <div className="workspace-toolbar-actions">
              <AIModelPicker
                label={t.common.imageModel}
                models={(imageCapability?.models ?? []).filter((model) => model.imageEnabled)}
                value={imageModel}
                disabled={imageGenerating || loading || state.busy}
                onChange={(id) => {
                  setImageModel(id);
                  clearGeneratedCover();
                }}
              />
              {imageGenerating ? (
                <Button
                  type="button"
                  variant="primary"
                  className="workspace-composer-send"
                  icon="square"
                  aria-label={t.common.stopGenerate}
                  title={t.common.stopGenerate}
                  onClick={() => stopGeneration(t.cover.stoppedNotice)}
                />
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  className="workspace-composer-send"
                  icon="arrow-up"
                  aria-label={generatedCover ? t.common.regenerate : t.common.generate}
                  title={generatedCover ? t.common.regenerate : t.common.generate}
                  disabled={!canGenerateCover || loading || state.busy}
                  onClick={() => void generateCover()}
                />
              )}
            </div>
          </div>
          {generatedCover && (
            <div className="ai-assist-footer desk-cover-ai-footer">
              <label>
                {t.common.usageLabel}
                <Select
                  className="workspace-field"
                  value={imageUse}
                  aria-label={t.common.usageAria}
                  disabled={loading || state.busy}
                  onChange={(event) => setImageUse(event.currentTarget.value as 'cover' | 'library')}
                >
                  <option value="cover">{t.cover.useCover}</option>
                  <option value="library">{t.common.libraryOnly}</option>
                </Select>
              </label>
              <Button
                type="button"
                variant="primary"
                disabled={loading || state.busy || (imageUse === 'library' && !!generatedCover.saved)}
                onClick={() => void uploadGeneratedCover()}
              >
                {imageUse === 'library'
                  ? generatedCover.saved
                    ? t.cover.savedToLibrary
                    : t.cover.saveToLibrary
                  : generatedCover.saved
                    ? t.cover.setCover
                    : t.cover.uploadAndSet}
              </Button>
            </div>
          )}
        </footer>
        <AIPanelResizers gesture={gesture} />
      </AnchorPopover>
      <AnchorPopover
        as="div"
        id={qualityId}
        open={qualityOpen && imagePanelOpen}
        anchor={qualityAnchor}
        role="dialog"
        aria-label={t.common.sizeAndQuality}
        className="desk-form-ai-picker ai-assist-picker workspace-app workspace-scrollbars"
        placement="top-end"
        gap={6}
        dismissOnFocusOutside
        onClose={() => setQualityOpen(false)}
      >
        <div className="ai-assist-reference-heading" data-ai-cover-size>
          <span>{t.cover.sizeLabel}</span>
          <strong>
            {formats[format].width}×{formats[format].height} px
          </strong>
          <HelpTip text={t.cover.qualityHelp} />
        </div>
        <fieldset className="ai-assist-picker-section ai-assist-quality">
          <legend>{t.common.qualityTitle}</legend>
          <output>{t.imageAI.qualities[articleImageQualityKeys[qualityIndex] ?? 'auto']}</output>
          <input
            className="workspace-range"
            style={rangeFill(Math.max(0, qualityIndex), articleImageQualityKeys.length - 1)}
            type="range"
            min="0"
            max={articleImageQualityKeys.length - 1}
            step="1"
            value={Math.max(0, qualityIndex)}
            aria-label={t.common.qualityAria}
            aria-valuetext={t.imageAI.qualities[articleImageQualityKeys[qualityIndex] ?? 'auto']}
            disabled={imageGenerating || loading || state.busy}
            onChange={(event) => {
              const next = articleImageQualityKeys[Number(event.currentTarget.value)];
              if (!next) return;
              setImageQuality(next);
              clearGeneratedCover();
            }}
          />
          <div className="ai-assist-quality-ticks" aria-hidden="true">
            {articleImageQualityKeys.map((value) => (
              <span key={value}>{t.imageAI.qualities[value]}</span>
            ))}
          </div>
        </fieldset>
      </AnchorPopover>
    </dialog>
  );
}
