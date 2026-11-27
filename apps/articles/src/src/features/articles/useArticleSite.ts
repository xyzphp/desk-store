import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHost, useSession } from '../../host/HostProvider';
import { prepareImage } from '../../shared/files/imageProcessing';
import { articleFileId, type ArticleFile, type ArticleSite, type ArticleSiteConfig } from './api';
import { readArticleFooterItems } from './footerItems';
import type { useArticles } from './useArticles';
import { articleText } from './locale';

type ArticleState = ReturnType<typeof useArticles>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeConfig(raw: ArticleSiteConfig): ArticleSiteConfig {
  const config = structuredClone(raw);
  const banners = config.banners;
  banners.enabled = banners.enabled !== false;
  banners.avatarEnabled = banners.avatarEnabled !== false;
  banners.homeEnabled = banners.homeEnabled !== false;
  banners.detailEnabled = banners.detailEnabled !== false;
  banners.archivesEnabled = banners.archivesEnabled !== false;
  banners.categoriesEnabled = banners.categoriesEnabled !== false;
  banners.tagsEnabled = banners.tagsEnabled !== false;
  config.quote = {
    mode: config.quote?.mode === 'none' || config.quote?.mode === 'api' ? config.quote.mode : 'manual',
    url: typeof config.quote?.url === 'string' ? config.quote.url : '',
    format: typeof config.quote?.format === 'string' ? config.quote.format : 'json',
    field: typeof config.quote?.field === 'string' ? config.quote.field : 'hitokoto',
  };
  const footer = config.footer;
  footer.enabled = footer.enabled !== false;
  footer.bgColor = typeof footer.bgColor === 'string' ? footer.bgColor : '';
  footer.textColor = typeof footer.textColor === 'string' ? footer.textColor : '';
  footer.bgImage = Number.isSafeInteger(footer.bgImage) ? footer.bgImage : 0;
  footer.bgImageUrl = typeof footer.bgImageUrl === 'string' ? footer.bgImageUrl : '';
  footer.bgMode = ['cover', 'contain', 'center', 'none'].includes(footer.bgMode) ? footer.bgMode : 'repeat';
  footer.bgOverlay = typeof footer.bgOverlay === 'string' ? footer.bgOverlay : '0';
  footer.borderStyle = ['gradient', 'dashed', 'none'].includes(footer.borderStyle) ? footer.borderStyle : 'solid';
  footer.align = footer.align === 'split' ? 'split' : 'center';
  footer.showPoweredBy = footer.showPoweredBy !== false;
  footer.copyright = typeof footer.copyright === 'string' ? footer.copyright : '';
  footer.recordLabel = typeof footer.recordLabel === 'string' ? footer.recordLabel : '';
  footer.recordUrl = typeof footer.recordUrl === 'string' ? footer.recordUrl : '';
  footer.items = readArticleFooterItems(footer.items);
  footer.columns = Array.isArray(footer.columns)
    ? footer.columns.map((column) => ({
        ...column,
        enabled: column.enabled !== false,
        title: typeof column.title === 'string' ? column.title : '',
        links: Array.isArray(column.links) ? column.links : [],
        items: Array.isArray(column.items) ? column.items : [],
      }))
    : [];
  return config;
}

export function useArticleSite(state: ArticleState) {
  const host = useHost();
  const session = useSession();
  const { isAdmin, request, loadFileLibrary, setSiteDirty, setError, setStatus } = state;
  const [site, setSite] = useState<ArticleSite>();
  const [config, setConfig] = useState<ArticleSiteConfig>();
  const [saved, setSaved] = useState('');
  const [quoteEdits, setQuoteEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [imageFiles, setImageFiles] = useState<ArticleFile[]>([]);
  const imageUpload = useRef<AbortController | null>(null);
  const configDirty = useMemo(() => !!config && JSON.stringify(config) !== saved, [config, saved]);
  const dirty = configDirty || Object.keys(quoteEdits).length > 0;

  useEffect(() => {
    setSiteDirty(dirty);
  }, [dirty, setSiteDirty]);
  useEffect(
    () => () => {
      imageUpload.current?.abort();
      setSiteDirty(false);
    },
    [setSiteDirty],
  );
  useEffect(() => {
    imageUpload.current?.abort();
    imageUpload.current = null;
  }, [session.generation, session.status]);

  const loadImages = useCallback(async () => {
    const items = await loadFileLibrary();
    const images = items.filter((file) => ['image/png', 'image/jpeg'].includes(file.mediaType));
    setImageFiles(images);
    return images;
  }, [loadFileLibrary]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError('');
    try {
      const response = await request('/site', { fallbackError: articleText().site.readFailed });
      if (!isRecord(response) || !isRecord(response.site) || !isRecord(response.site.config))
        throw new Error(articleText().site.formatError);
      const current = response.site as unknown as ArticleSite;
      const next = normalizeConfig(current.config);
      setSite(current);
      setConfig(next);
      setSaved(JSON.stringify(next));
      setQuoteEdits({});
      await loadImages();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : articleText().site.readFailed);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, loadImages, request, setError]);

  const update = useCallback(
    (change: (current: ArticleSiteConfig) => ArticleSiteConfig) => {
      setConfig((current) => (current ? change(current) : current));
      setError('');
      setStatus('');
    },
    [setError, setStatus],
  );

  const save = useCallback(async () => {
    if (!isAdmin || !site || !config || busy) return false;
    if (!configDirty) return true;
    setBusy(true);
    setError('');
    try {
      const response = await request('/site', {
        method: 'PUT',
        body: { revision: site.revision, config },
        fallbackError: articleText().site.saveFailed,
      });
      if (!isRecord(response) || !isRecord(response.site) || !isRecord(response.site.config))
        throw new Error(articleText().site.saveFormatError);
      const current = response.site as unknown as ArticleSite;
      const next = normalizeConfig(current.config);
      setSite(current);
      setConfig(next);
      setSaved(JSON.stringify(next));
      host.fileLibrary.changed();
      setStatus(articleText().site.applied);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : articleText().site.saveFailed);
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, config, configDirty, host, isAdmin, request, setError, setStatus, site]);

  const uploadImage = useCallback(
    async (original: File) => {
      if (!isAdmin || busy || !['image/png', 'image/jpeg'].includes(original.type))
        throw new Error(articleText().site.imageTypeUnsupported);
      const controller = new AbortController();
      imageUpload.current?.abort();
      imageUpload.current = controller;
      setBusy(true);
      setError('');
      try {
        const file = (await prepareImage(original, 'recommended', true, controller.signal)).file;
        const body = new FormData();
        body.set('file', file);
        const response = await host.upload<unknown>('articles/files/upload', body, {
          signal: controller.signal,
          fallbackError: articleText().site.imageUploadFailed,
        });
        if (
          !isRecord(response) ||
          response.ok !== true ||
          !isRecord(response.file) ||
          typeof response.file.id !== 'string'
        ) {
          throw new Error(articleText().site.imageUploadFormatError);
        }
        const id = articleFileId(response.file as unknown as ArticleFile);
        if (!id) throw new Error(articleText().site.imageIdInvalid);
        host.fileLibrary.changed();
        await loadImages();
        return id;
      } finally {
        if (imageUpload.current === controller) imageUpload.current = null;
        setBusy(false);
      }
    },
    [busy, host, isAdmin, loadImages, setError],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return {
    site,
    config,
    loading,
    busy,
    dirty,
    configDirty,
    quoteEdits,
    setQuoteEdits,
    imageFiles,
    load,
    loadImages,
    update,
    save,
    uploadImage,
  };
}
