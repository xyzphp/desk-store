import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHost, useSession } from '../../host/HostProvider';
import { useAppLaunch } from '../../shared/hooks/useAppLaunch';
import { useDialogs } from '../../shared/hooks/useDialogs';
import { canUse } from '../../shared/hooks/permission';
import { isAbort } from '../../shared/hooks/useRequest';
import { useSessionGuard } from '../../shared/hooks/useSessionGuard';
import { useWorkspaceState } from '../../shared/hooks/useWorkspaceState';
import {
  articleDraftKey,
  emptyArticleDraft,
  type ArticleCatalog,
  type ArticleDetail,
  type ArticleDraft,
  type ArticleFile,
  type ArticleRecord,
  type ArticleSummary,
  type ArticleTaxonomy,
  type ArticleView,
  type ArticleWorkspace,
  type TaxonomyKind,
  articleFileId,
} from './api';
import { buildCategoryTree, visibleArticles } from './model';
import { useArticleRequest } from './useArticleRequest';
import { prepareImage } from '../../shared/files/imageProcessing';
import { articleText } from './locale';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validTaxonomy(value: unknown): value is ArticleTaxonomy {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.id) &&
    Number(value.id) > 0 &&
    (value.kind === 'category' || value.kind === 'tag') &&
    typeof value.name === 'string' &&
    Number.isSafeInteger(value.parentId) &&
    Number(value.parentId) >= 0 &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) >= 0
  );
}

function readCatalog(value: unknown): ArticleCatalog {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.items) || !Array.isArray(value.taxonomies)) {
    throw new Error(articleText().hooks.listFormatError);
  }
  if (!value.items.every(isRecord) || !value.taxonomies.every(validTaxonomy) || typeof value.publicBase !== 'string') {
    throw new Error(articleText().hooks.listFormatError);
  }
  return {
    items: value.items as unknown as ArticleSummary[],
    taxonomies: value.taxonomies,
    publicBase: value.publicBase,
  };
}

function readDetail(value: unknown): ArticleDetail {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.article) || !Array.isArray(value.files)) {
    throw new Error(articleText().hooks.detailFormatError);
  }
  return { article: value.article as unknown as ArticleRecord, files: value.files as ArticleFile[] };
}

function readWorkspace(value: unknown): ArticleWorkspace | undefined {
  if (!isRecord(value)) return undefined;
  const filter = isRecord(value.filter) ? value.filter : value;
  const view: ArticleView = ['all', 'draft', 'private', 'public', 'trash'].includes(String(filter.view))
    ? (filter.view as ArticleView)
    : 'all';
  const rawDraft = isRecord(value.draft) ? value.draft : undefined;
  if (
    rawDraft &&
    (typeof rawDraft.title !== 'string' ||
      typeof rawDraft.summary !== 'string' ||
      typeof rawDraft.content !== 'string' ||
      !['private', 'public'].includes(String(rawDraft.visibility)) ||
      !Number.isSafeInteger(rawDraft.categoryId) ||
      !Number.isSafeInteger(rawDraft.coverFileId) ||
      Number(rawDraft.coverFileId) < 0 ||
      !Number.isSafeInteger(rawDraft.coverWidth) ||
      Number(rawDraft.coverWidth) < 0 ||
      !Number.isSafeInteger(rawDraft.coverHeight) ||
      Number(rawDraft.coverHeight) < 0 ||
      !Array.isArray(rawDraft.tagIds) ||
      !rawDraft.tagIds.every((id) => Number.isSafeInteger(id) && Number(id) > 0) ||
      !Array.isArray(rawDraft.fileIds) ||
      !rawDraft.fileIds.every((id) => Number.isSafeInteger(id) && Number(id) > 0))
  )
    return undefined;
  const validRecordId =
    Number.isSafeInteger(value.articleId) && Number(value.articleId) > 0 ? Number(value.articleId) : 0;
  const layout = value.layout === 'list' ? 'list' : 'card';
  return {
    view,
    query: typeof filter.query === 'string' ? filter.query.slice(0, 100) : '',
    category: Number.isSafeInteger(filter.category) && Number(filter.category) > 0 ? Number(filter.category) : 0,
    tag: Number.isSafeInteger(filter.tag) && Number(filter.tag) > 0 ? Number(filter.tag) : 0,
    articleId: validRecordId,
    ...(rawDraft ? { draft: rawDraft as unknown as ArticleDraft } : {}),
    ...(Number.isSafeInteger(value.revision) ? { revision: Number(value.revision) } : {}),
    layout,
    libraryCollapsed: value.libraryCollapsed === true,
    sidebarWidth: Number.isFinite(value.sidebarWidth) ? Math.max(150, Math.min(420, Number(value.sidebarWidth))) : 224,
    libraryWidth: Number.isFinite(value.libraryWidth) ? Math.max(200, Math.min(520, Number(value.libraryWidth))) : 292,
    categoriesCollapsed: value.categoriesCollapsed === true,
    tagsCollapsed: value.tagsCollapsed === true,
    collapsedCategoryIds: Array.isArray(value.collapsedCategoryIds)
      ? value.collapsedCategoryIds
          .filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0)
          .slice(0, 200)
      : [],
    ...(value.editorMode === 'edit' || value.editorMode === 'split' || value.editorMode === 'preview'
      ? { editorMode: value.editorMode }
      : {}),
  };
}

function copyDraft(value: ArticleDraft): ArticleDraft {
  return {
    title: value.title,
    summary: value.summary,
    content: value.content,
    visibility: value.visibility === 'public' ? 'public' : 'private',
    categoryId: value.categoryId,
    coverFileId: value.coverFileId || 0,
    coverWidth: value.coverWidth || 0,
    coverHeight: value.coverHeight || 0,
    tagIds: [...value.tagIds],
    fileIds: [...value.fileIds],
  };
}

export function useArticles() {
  const session = useSession();
  const host = useHost();
  const launch = useAppLaunch();
  const request = useArticleRequest();
  const allowed = session.status === 'ready' && canUse(session, 'article-management');
  const isAdmin = session.status === 'ready' && !!session.user?.isAdmin;
  const dialogs = useDialogs(allowed);
  const [catalog, setCatalog] = useState<ArticleCatalog>();
  const [record, setRecord] = useState<ArticleRecord | null>(null);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);
  const [editorInitialContent, setEditorInitialContent] = useState('');
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [baseline, setBaseline] = useState('');
  const [files, setFiles] = useState<ArticleFile[]>([]);
  const [view, setView] = useState<ArticleView>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(0);
  const [tag, setTag] = useState(0);
  const [layout, setLayout] = useState<'card' | 'list'>('card');
  const [editorMode, setEditorMode] = useState<'edit' | 'split' | 'preview'>('edit');
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const [libraryWidth, setLibraryWidth] = useState(292);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [siteOpen, setSiteOpen] = useState(false);
  const [siteDirty, setSiteDirty] = useState(false);
  const [siteTab, setSiteTab] = useState<'brand' | 'banners' | 'footer' | 'categories' | 'tags'>('brand');
  const [categoriesCollapsed, setCategoriesCollapsed] = useState(false);
  const [tagsCollapsed, setTagsCollapsed] = useState(false);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<number[]>([]);
  const generation = useRef(0);
  const currentRequest = useRef<AbortController | undefined>(undefined);
  const uploadRequest = useRef<AbortController | undefined>(undefined);
  const dirty = !!draft && articleDraftKey(draft) !== baseline;
  const visible = useMemo(
    () => visibleArticles(catalog?.items ?? [], { view, category, tag, query }, catalog?.taxonomies ?? []),
    [catalog?.items, catalog?.taxonomies, category, query, tag, view],
  );
  const categoryTree = useMemo(() => buildCategoryTree(catalog?.taxonomies ?? []), [catalog?.taxonomies]);
  const tagItems = useMemo(
    () => (catalog?.taxonomies ?? []).filter((item) => item.kind === 'tag'),
    [catalog?.taxonomies],
  );

  const clear = useCallback(() => {
    currentRequest.current?.abort();
    uploadRequest.current?.abort();
    currentRequest.current = undefined;
    generation.current++;
    setCatalog(undefined);
    setRecord(null);
    setDraft(null);
    setEditorInitialContent('');
    setEditorResetKey((value) => value + 1);
    setBaseline('');
    setFiles([]);
    setSiteOpen(false);
    setSiteDirty(false);
    setLoading(false);
    setBusy(false);
    setError('');
    setStatus('');
  }, []);
  useSessionGuard(clear);

  const loadCatalog = useCallback(
    async (signal?: AbortSignal) => {
      const result = readCatalog(await request('', { signal, fallbackError: articleText().hooks.listLoadFailed }));
      if (!signal?.aborted) setCatalog(result);
      return result;
    },
    [request],
  );

  useEffect(() => {
    if (!allowed) {
      clear();
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadCatalog(controller.signal)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted && !isAbort(failure))
          setError(failure instanceof Error ? failure.message : articleText().hooks.listLoadFailed);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [allowed, clear, loadCatalog, session.generation]);

  const discard = useCallback(
    async (message: string) => {
      if (!dirty) return true;
      return dialogs.confirm({
        title: articleText().hooks.discardTitle,
        message,
        confirmLabel: articleText().hooks.discardAction,
        danger: true,
      });
    },
    [dialogs, dirty],
  );

  const selectArticle = useCallback(
    async (id: number) => {
      if (record?.id === id || busy || !(await discard(articleText().hooks.discardSwitch))) return;
      const controller = new AbortController();
      currentRequest.current?.abort();
      currentRequest.current = controller;
      const requestGeneration = ++generation.current;
      setLoading(true);
      setError('');
      try {
        const result = readDetail(
          await request(`/${id}`, { signal: controller.signal, fallbackError: articleText().hooks.readFailed }),
        );
        if (controller.signal.aborted || requestGeneration !== generation.current) return;
        setRecord(result.article);
        setDraft(copyDraft(result.article.draft));
        setEditorInitialContent(result.article.draft.content);
        setEditorResetKey((value) => value + 1);
        setEditorMode('edit');
        setBaseline(articleDraftKey(result.article.draft));
        setFiles(result.files);
        setStatus('');
      } catch (failure) {
        if (!controller.signal.aborted && !isAbort(failure))
          setError(failure instanceof Error ? failure.message : articleText().hooks.readFailed);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [busy, discard, record?.id, request],
  );

  const createDraft = useCallback(async () => {
    if (busy || !(await discard(articleText().hooks.discardCreate))) return;
    currentRequest.current?.abort();
    generation.current++;
    setSiteOpen(false);
    setRecord(null);
    setDraft(emptyArticleDraft());
    setEditorInitialContent('');
    setEditorResetKey((value) => value + 1);
    setEditorMode('edit');
    setBaseline('');
    setFiles([]);
    setView('all');
    setCategory(0);
    setTag(0);
    setError('');
    setStatus('');
  }, [busy, discard]);

  const refresh = useCallback(
    async (discardDraft = false) => {
      if (busy || (!discardDraft && dirty && !(await discard(articleText().hooks.discardReload)))) return;
      const controller = new AbortController();
      currentRequest.current?.abort();
      currentRequest.current = controller;
      setLoading(true);
      setError('');
      try {
        const result = await loadCatalog(controller.signal);
        if (controller.signal.aborted) return;
        if (record?.id && !result.items.some((item) => item.id === record.id)) {
          setRecord(null);
          setDraft(null);
          setEditorInitialContent('');
          setEditorResetKey((value) => value + 1);
          setBaseline('');
          setFiles([]);
        }
      } catch (failure) {
        if (!controller.signal.aborted && !isAbort(failure))
          setError(failure instanceof Error ? failure.message : articleText().hooks.listLoadFailed);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [busy, dirty, discard, loadCatalog, record?.id],
  );

  const updateDraft = useCallback((patch: Partial<ArticleDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setStatus('');
  }, []);

  const save = useCallback(
    async (publish = false) => {
      if (!draft || !dirty || busy || record?.trashedAt) return;
      if (publish) {
        if (!draft.title.trim() || !draft.content.trim()) {
          setError(articleText().hooks.publishNeedsContent);
          return;
        }
        const confirmed = await dialogs.confirm({
          title:
            draft.visibility === 'public'
              ? articleText().hooks.publishPublicTitle
              : articleText().hooks.publishPrivateTitle,
          message:
            draft.visibility === 'public'
              ? articleText().hooks.publishPublicMessage
              : articleText().hooks.publishPrivateMessage,
          confirmLabel: record?.publishedAt ? articleText().hooks.updatePublish : articleText().hooks.publishArticle,
        });
        if (!confirmed || !allowed) return;
      }
      setBusy(true);
      setError('');
      setStatus(articleText().hooks.saving);
      const revision = record?.revision ?? 0;
      const generationAtStart = generation.current;
      try {
        const result = await request(record ? `/${record.id}` : '', {
          method: record ? 'PUT' : 'POST',
          body: { revision, action: publish ? 'publish' : 'save', draft: copyDraft(draft) },
          fallbackError: publish ? articleText().hooks.publishFailed : articleText().hooks.saveFailed,
        });
        if (!isRecord(result) || result.ok !== true || !isRecord(result.article))
          throw new Error(articleText().hooks.saveFormatError);
        if (generationAtStart !== generation.current || !allowed) return;
        const saved = result.article as unknown as ArticleRecord;
        setRecord(saved);
        setDraft(copyDraft(saved.draft));
        setBaseline(articleDraftKey(saved.draft));
        setStatus(publish ? articleText().hooks.published : articleText().hooks.draftSaved);
        await refresh(true);
      } catch (failure) {
        if (!isAbort(failure)) setError(failure instanceof Error ? failure.message : articleText().hooks.saveFailed);
      } finally {
        if (generationAtStart === generation.current) setBusy(false);
      }
    },
    [allowed, busy, dialogs, dirty, draft, record, refresh, request],
  );

  const articleAction = useCallback(
    async (action: 'trash' | 'delete' | 'unpublish' | 'restore') => {
      if (!record || busy) return;
      const labels = {
        trash: articleText().hooks.trashConfirmTitle,
        delete: articleText().hooks.deleteConfirmTitle,
        unpublish: articleText().hooks.unpublishConfirmTitle,
        restore: '',
      };
      const messages = {
        trash: articleText().hooks.trashConfirmMessage,
        delete: articleText().hooks.deleteConfirmMessage,
        unpublish: articleText().hooks.unpublishConfirmMessage,
        restore: '',
      };
      if (
        action !== 'restore' &&
        !(await dialogs.confirm({ title: labels[action], message: messages[action], danger: true }))
      )
        return;
      const current = record;
      setBusy(true);
      setError('');
      try {
        const result = await request(`/${current.id}/actions`, {
          method: 'POST',
          body: { action, revision: current.revision },
          fallbackError: articleText().hooks.actionFailed,
        });
        if (!isRecord(result) || result.ok !== true) throw new Error(articleText().hooks.actionFormatError);
        if (action === 'delete') {
          setRecord(null);
          setDraft(null);
          setEditorInitialContent('');
          setEditorResetKey((value) => value + 1);
          setBaseline('');
          setFiles([]);
        } else if (isRecord(result.article)) {
          const next = result.article as unknown as ArticleRecord;
          setRecord(next);
          setDraft(copyDraft(next.draft));
          setEditorInitialContent(next.draft.content);
          setEditorResetKey((value) => value + 1);
          setBaseline(articleDraftKey(next.draft));
        }
        setStatus(
          action === 'trash'
            ? articleText().hooks.trashed
            : action === 'delete'
              ? articleText().hooks.deleted
              : action === 'restore'
                ? articleText().hooks.restored
                : articleText().hooks.unpublished,
        );
        await refresh(true);
      } catch (failure) {
        if (!isAbort(failure)) setError(failure instanceof Error ? failure.message : articleText().hooks.actionFailed);
      } finally {
        setBusy(false);
      }
    },
    [busy, dialogs, record, refresh, request],
  );

  const mutateTaxonomy = useCallback(
    async (input: {
      id: number;
      kind: TaxonomyKind;
      name: string;
      parentId: number;
      revision: number;
      action: 'save' | 'delete';
    }) => {
      const initialIds = new Set(catalog?.taxonomies.map((item) => item.id) ?? []);
      const reconcile = async () => {
        const latest = await loadCatalog();
        if (input.action === 'delete')
          return { confirmed: !latest.taxonomies.some((item) => item.id === input.id), taxonomy: undefined };
        const taxonomy = latest.taxonomies.find(
          (item) =>
            item.kind === input.kind &&
            item.name === input.name &&
            item.parentId === input.parentId &&
            (input.id === 0 ? !initialIds.has(item.id) : item.id === input.id && item.revision > input.revision),
        );
        return { confirmed: !!taxonomy, taxonomy };
      };
      const apply = (id: number, reconciled?: ArticleTaxonomy) => {
        if (input.action === 'delete') {
          setCatalog((current) => {
            const base = current ?? { items: [], taxonomies: [], publicBase: '' };
            return { ...base, taxonomies: base.taxonomies.filter((item) => item.id !== id) };
          });
          return { ok: true, id, taxonomy: undefined as ArticleTaxonomy | undefined };
        }
        const taxonomy = reconciled ?? {
          id,
          kind: input.kind,
          name: input.name,
          parentId: input.parentId,
          revision: input.id === 0 ? 1 : input.revision + 1,
        };
        setCatalog((current) => {
          const base = current ?? { items: [], taxonomies: [], publicBase: '' };
          const exists = base.taxonomies.some((item) => item.id === id);
          const taxonomies = exists
            ? base.taxonomies.map((item) => (item.id === id ? taxonomy : item))
            : [...base.taxonomies, taxonomy];
          return { ...base, taxonomies };
        });
        return { ok: true, id, taxonomy };
      };
      let result: unknown;
      try {
        result = await request('/taxonomies', {
          method: 'POST',
          body: input,
          fallbackError: articleText().hooks.taxonomySaveFailed,
        });
      } catch (failure) {
        if (isAbort(failure)) throw failure;
        try {
          const current = await reconcile();
          if (current.confirmed) {
            const id = current.taxonomy?.id ?? input.id;
            return apply(id, current.taxonomy);
          }
        } catch {
          throw new Error(articleText().hooks.taxonomyPendingError);
        }
        const statusCode = isRecord(failure) && Number.isInteger(failure.status) ? Number(failure.status) : 0;
        if (statusCode >= 400 && statusCode < 500) throw failure;
        throw new Error(articleText().hooks.taxonomyPendingError);
      }
      if (
        isRecord(result) &&
        result.ok === true &&
        Number.isSafeInteger(result.id) &&
        Number(result.id) > 0 &&
        (input.id === 0 || Number(result.id) === input.id)
      )
        return apply(Number(result.id));
      try {
        const current = await reconcile();
        if (current.confirmed) {
          const id = current.taxonomy?.id ?? input.id;
          return apply(id, current.taxonomy);
        }
      } catch {
        throw new Error(articleText().hooks.taxonomyPendingError);
      }
      throw new Error(articleText().hooks.taxonomyFormatError);
    },
    [catalog, loadCatalog, request],
  );

  const loadFileLibrary = useCallback(async () => {
    const result = await request('/files', { fallbackError: articleText().hooks.filesLoadFailed });
    if (!isRecord(result) || result.ok !== true || !Array.isArray(result.files))
      throw new Error(articleText().hooks.filesFormatError);
    const next = result.files.filter(
      (file): file is ArticleFile =>
        isRecord(file) &&
        typeof file.id === 'string' &&
        typeof file.name === 'string' &&
        typeof file.mediaType === 'string' &&
        Number.isSafeInteger(file.size) &&
        file.kind === 'file' &&
        !Number(file.trashedAt),
    );
    setFiles((current) => {
      const merged = new Map(current.map((file) => [file.id, file]));
      next.forEach((file) => merged.set(file.id, file));
      return [...merged.values()];
    });
    return next;
  }, [request]);

  const uploadFiles = useCallback(
    async (incoming: readonly File[], options: { preserveImage?: boolean; attachToDraft?: boolean } = {}) => {
      if (!allowed || !draft || busy || incoming.length === 0) return [];
      const attachToDraft = options.attachToDraft !== false;
      uploadRequest.current?.abort();
      const controller = new AbortController();
      uploadRequest.current = controller;
      const generationAtStart = generation.current;
      setBusy(true);
      setError('');
      setStatus(articleText().hooks.uploading);
      const uploadedFiles: ArticleFile[] = [];
      try {
        for (const original of incoming) {
          if (controller.signal.aborted || generationAtStart !== generation.current || !allowed) return uploadedFiles;
          let file = original;
          if (original.type.startsWith('image/') && !options.preserveImage) {
            try {
              file = (await prepareImage(original, 'recommended', true, controller.signal)).file;
            } catch (failure) {
              if (controller.signal.aborted || (failure instanceof DOMException && failure.name === 'AbortError'))
                throw failure;
            }
          }
          const body = new FormData();
          body.set('file', file);
          const result = await host.upload<unknown>('articles/files/upload', body, {
            signal: controller.signal,
            fallbackError: articleText().hooks.uploadFailed,
          });
          if (!isRecord(result) || result.ok !== true || !isRecord(result.file) || typeof result.file.id !== 'string') {
            throw new Error(articleText().hooks.uploadFormatError);
          }
          const uploaded = result.file as unknown as ArticleFile;
          const uploadedId = articleFileId(uploaded);
          if (!uploadedId) throw new Error(articleText().hooks.uploadIdInvalid);
          if (generationAtStart !== generation.current || !allowed) return uploadedFiles;
          uploadedFiles.push(uploaded);
          setFiles((current) => [...current.filter((item) => item.id !== uploaded.id), uploaded]);
          if (attachToDraft) {
            setDraft((current) =>
              current
                ? {
                    ...current,
                    fileIds: [...new Set([...current.fileIds, uploadedId])],
                  }
                : current,
            );
          }
        }
        host.fileLibrary.changed();
        setStatus(attachToDraft ? articleText().hooks.attachmentsAdded : articleText().hooks.imagesSaved);
        return uploadedFiles;
      } catch (failure) {
        if (!controller.signal.aborted && !(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : articleText().hooks.uploadFailed);
        }
        return uploadedFiles;
      } finally {
        if (uploadRequest.current === controller) uploadRequest.current = undefined;
        if (generationAtStart === generation.current) setBusy(false);
      }
    },
    [allowed, busy, draft, host],
  );

  const pickFromFileManager = useCallback(
    async (options: { attachToDraft?: boolean; imagesOnly?: boolean } = {}) => {
      if (!allowed || busy) return null;
      const attachToDraft = options.attachToDraft === true;
      const picked = await host.pickPlatformFile();
      if (!picked || !picked.fileId) return null;
      if (options.imagesOnly && !/^image\/(png|jpeg|webp)$/i.test(picked.mediaType || '')) {
        setError(articleText().cover.typeUnsupported);
        return null;
      }
      setBusy(true);
      setError('');
      try {
        const reg = await request('/files/register', {
          method: 'POST',
          body: {
            fileId: picked.fileId,
            name: picked.name || 'file',
            mediaType: picked.mediaType || 'application/octet-stream',
            size: picked.size || 0,
          },
          fallbackError: articleText().hooks.uploadFailed,
        });
        if (!isRecord(reg) || reg.ok !== true || !isRecord(reg.file) || typeof reg.file.id !== 'string') {
          throw new Error(articleText().hooks.uploadFormatError);
        }
        const registered = reg.file as unknown as ArticleFile;
        const fid = articleFileId(registered);
        if (!fid) throw new Error(articleText().hooks.uploadIdInvalid);
        setFiles((current) => [...current.filter((item) => item.id !== registered.id), registered]);
        if (attachToDraft) {
          setDraft((current) =>
            current ? { ...current, fileIds: [...new Set([...current.fileIds, fid])] } : current,
          );
        }
        return { file: registered, tempUrl: picked.url };
      } catch (failure) {
        if (!isAbort(failure)) {
          setError(failure instanceof Error ? failure.message : articleText().hooks.uploadFailed);
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [allowed, busy, host, request],
  );

  const openSite = useCallback(
    async (tab: typeof siteTab = 'brand') => {
      if (!isAdmin) return;
      if (siteOpen) {
        setSiteTab(tab);
        return;
      }
      if (!(await discard(articleText().hooks.openSiteDiscard))) return;
      currentRequest.current?.abort();
      generation.current++;
      setRecord(null);
      setDraft(null);
      setBaseline('');
      setFiles([]);
      setSiteTab(tab);
      setSiteOpen(true);
      setSiteDirty(false);
      setError('');
      setStatus('');
    },
    [discard, isAdmin, siteOpen],
  );

  const closeSite = useCallback(async () => {
    if (
      siteDirty &&
      !(await dialogs.confirm({
        title: articleText().hooks.discardSiteTitle,
        message: articleText().hooks.discardSiteMessage,
        danger: true,
      }))
    )
      return false;
    setSiteOpen(false);
    setSiteDirty(false);
    return true;
  }, [dialogs, siteDirty]);

  const workspaceChanged = useWorkspaceState('articles', {
    capture: () => {
      if (!allowed || !catalog || siteOpen || busy) return null;
      const snapshot: ArticleWorkspace = {
        view,
        query,
        category,
        tag,
        articleId: record?.id ?? 0,
        layout,
        libraryCollapsed,
        sidebarWidth,
        libraryWidth,
        categoriesCollapsed,
        tagsCollapsed,
        collapsedCategoryIds,
        editorMode,
      };
      if (draft && dirty) {
        snapshot.draft = copyDraft(draft);
        if (record) snapshot.revision = record.revision;
      }
      return snapshot;
    },
    async restore(raw) {
      if (!allowed) return;
      const snapshot = readWorkspace(raw);
      if (!snapshot) return;
      const result = await loadCatalog();
      setView(snapshot.view);
      setQuery(snapshot.query);
      setCategory(snapshot.category);
      setTag(snapshot.tag);
      setLayout(snapshot.layout);
      setEditorMode(snapshot.editorMode ?? 'edit');
      setLibraryCollapsed(snapshot.libraryCollapsed);
      setSidebarWidth(
        Number.isFinite(snapshot.sidebarWidth) ? Math.max(150, Math.min(420, Number(snapshot.sidebarWidth))) : 224,
      );
      setLibraryWidth(
        Number.isFinite(snapshot.libraryWidth) ? Math.max(200, Math.min(520, Number(snapshot.libraryWidth))) : 292,
      );
      setCategoriesCollapsed(snapshot.categoriesCollapsed === true);
      setTagsCollapsed(snapshot.tagsCollapsed === true);
      setCollapsedCategoryIds(
        Array.isArray(snapshot.collapsedCategoryIds) ? snapshot.collapsedCategoryIds.filter(Number.isSafeInteger) : [],
      );
      const id = snapshot.articleId;
      const summary = result.items.find((item) => item.id === id);
      if (id && summary) {
        if (snapshot.revision && summary.revision !== snapshot.revision)
          throw new Error(articleText().hooks.workspaceConflict);
        await selectArticle(id);
      }
      if (snapshot.draft) {
        setDraft(copyDraft(snapshot.draft));
        setEditorInitialContent(snapshot.draft.content);
        setEditorResetKey((value) => value + 1);
      }
      setEditorMode(snapshot.editorMode ?? 'edit');
    },
    blocked: () => busy || siteDirty,
    beforeClose: async () => {
      if (siteOpen)
        return (
          !siteDirty ||
          dialogs.confirm({
            title: articleText().hooks.discardSiteTitle,
            message: articleText().hooks.discardSiteMessage,
            danger: true,
          })
        );
      return discard(articleText().hooks.closeDiscard);
    },
  });

  useEffect(() => {
    if (allowed && catalog) workspaceChanged();
  }, [
    allowed,
    baseline,
    busy,
    category,
    categoriesCollapsed,
    collapsedCategoryIds,
    catalog,
    draft,
    editorInitialContent,
    editorResetKey,
    editorMode,
    layout,
    libraryCollapsed,
    libraryWidth,
    query,
    record?.id,
    sidebarWidth,
    siteOpen,
    status,
    tag,
    tagsCollapsed,
    view,
    workspaceChanged,
  ]);

  const setFilter = useCallback(
    (next: Partial<{ view: ArticleView; query: string; category: number; tag: number }>) => {
      if (next.view !== undefined) setView(next.view);
      if (next.query !== undefined) setQuery(next.query.slice(0, 100));
      if (next.category !== undefined) setCategory(next.category);
      if (next.tag !== undefined) setTag(next.tag);
    },
    [],
  );
  const notifyChanged = useCallback(() => workspaceChanged(), [workspaceChanged]);

  return {
    allowed,
    isAdmin,
    catalog,
    categoryTree,
    tagItems,
    record,
    draft,
    editorInitialContent,
    editorResetKey,
    files,
    view,
    query,
    category,
    tag,
    layout,
    editorMode,
    libraryCollapsed,
    siteTab,
    categoriesCollapsed,
    tagsCollapsed,
    collapsedCategoryIds,
    sidebarWidth,
    libraryWidth,
    loading,
    busy,
    dirty,
    error,
    status,
    siteOpen,
    visible,
    setView,
    setQuery,
    setFilter,
    setLayout,
    setEditorMode,
    setLibraryCollapsed,
    setSidebarWidth,
    setLibraryWidth,
    setCategoriesCollapsed,
    setTagsCollapsed,
    setCollapsedCategoryIds,
    setDraft: updateDraft,
    setError,
    setStatus,
    setSiteTab,
    setSiteOpen,
    openSite,
    request,
    dialogs,
    launch,
    refresh,
    selectArticle,
    createDraft,
    save,
    articleAction,
    mutateTaxonomy,
    loadFileLibrary,
    uploadFiles,
    pickFromFileManager,
    notifyChanged,
    siteDirty,
    setSiteDirty,
    closeSite,
  };
}
