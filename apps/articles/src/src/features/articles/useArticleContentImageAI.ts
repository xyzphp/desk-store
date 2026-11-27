import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useHost, useSession } from '../../host/HostProvider';
import { canUse } from '../../shared/hooks/permission';
import { generateAIImage } from '../../shared/ai/generatedImage';
import type { FormAIIdentity } from '../../shared/ai/formAI';
import type { ArticleFile } from './api';
import {
  articleImageAvailable,
  createArticleContentImageRequest,
  readArticleImageCapability,
  type ArticleImageCapability,
  type ArticleImageQuality,
} from './articleImageAI';
import { articleText } from './locale';

export type ArticleContentImageUse = 'append' | 'replace' | 'library';

export interface ArticleContentImageSelection {
  source: string;
  start: number;
  end: number;
  caret: number;
}

interface ArticleContentImageResult {
  blob: Blob;
  url: string;
  identityKey: string;
  fieldsKey: string;
  saved?: ArticleFile;
}

interface ArticleContentImageSnapshot {
  identity: FormAIIdentity;
  identityKey: string;
  fields: Readonly<Record<string, string>>;
  fieldsKey: string;
  selection: ArticleContentImageSelection;
}

export interface ArticleContentImageAIOptions {
  active: boolean;
  identity: FormAIIdentity;
  fields: Readonly<Record<string, string>>;
  onUseFile(
    file: ArticleFile,
    selection: ArticleContentImageSelection,
    use: ArticleContentImageUse,
  ): boolean | Promise<boolean>;
  onStatus(message: string): void;
  onBusyChange(busy: boolean): void;
  uploadFile(file: File): Promise<ArticleFile | undefined>;
}

export interface ArticleContentImageAIState {
  open: boolean;
  capability?: ArticleImageCapability;
  phase: 'idle' | 'loading' | 'generating' | 'applying';
  busy: boolean;
  selection?: ArticleContentImageSelection;
  error: string;
  setError(value: string): void;
  result?: ArticleContentImageResult;
  modelId: string;
  setModelId(value: string): void;
  size: string;
  setSize(value: string): void;
  customWidth: string;
  setCustomWidth(value: string): void;
  customHeight: string;
  setCustomHeight(value: string): void;
  quality: ArticleImageQuality;
  setQuality(value: ArticleImageQuality): void;
  instruction: string;
  setInstruction(value: string): void;
  references: string[];
  setReferences(value: string[] | ((current: string[]) => string[])): void;
  use: ArticleContentImageUse;
  setUse(value: ArticleContentImageUse): void;
  clearResult(): void;
  show(selection: ArticleContentImageSelection): Promise<void>;
  close(): void;
  stop(): void;
  generate(): Promise<void>;
  apply(): Promise<boolean>;
}

const cloneIdentity = (identity: FormAIIdentity) => JSON.parse(JSON.stringify(identity)) as FormAIIdentity;

export function useArticleContentImageAI(options: ArticleContentImageAIOptions): ArticleContentImageAIState {
  const host = useHost();
  const session = useSession();
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const identityKey = JSON.stringify(options.identity);
  const identity = useMemo(() => JSON.parse(identityKey) as FormAIIdentity, [identityKey]);
  const fieldsKey = JSON.stringify(options.fields);
  const [open, setOpen] = useState(false);
  const [capability, setCapability] = useState<ArticleImageCapability>();
  const [phase, setPhase] = useState<'idle' | 'loading' | 'generating' | 'applying'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ArticleContentImageResult>();
  const [modelId, setModelId] = useState('');
  const [size, setSize] = useState<string>('auto');
  const [customWidth, setCustomWidth] = useState('16');
  const [customHeight, setCustomHeight] = useState('9');
  const [quality, setQuality] = useState<ArticleImageQuality>('auto');
  const [instruction, setInstruction] = useState('');
  const [references, setReferences] = useState<string[]>([]);
  const [use, setUse] = useState<ArticleContentImageUse>('append');
  const [selection, setSelection] = useState<ArticleContentImageSelection>();
  const operation = useRef<AbortController | null>(null);
  const imageSnapshot = useRef<ArticleContentImageSnapshot | undefined>(undefined);
  const resultRef = useRef<ArticleContentImageResult | undefined>(undefined);
  const generation = session.generation;

  const clearResult = useCallback(() => {
    const current = resultRef.current;
    if (current) URL.revokeObjectURL(current.url);
    resultRef.current = undefined;
    setResult(undefined);
  }, []);

  const cancel = useCallback(() => {
    operation.current?.abort();
    operation.current = null;
    setPhase('idle');
  }, []);

  const identityIsCurrent = useCallback(
    (snapshot: ArticleContentImageSnapshot) => {
      const current = host.getSession();
      return (
        latest.current.active &&
        current.status === 'ready' &&
        current.generation === generation &&
        canUse(current, 'article-management') &&
        JSON.stringify(latest.current.identity) === snapshot.identityKey
      );
    },
    [generation, host],
  );

  const fieldsAreCurrent = useCallback(
    (snapshot: ArticleContentImageSnapshot) => JSON.stringify(latest.current.fields) === snapshot.fieldsKey,
    [],
  );

  const isCurrent = useCallback(
    (snapshot: ArticleContentImageSnapshot, controller?: AbortController) =>
      identityIsCurrent(snapshot) &&
      fieldsAreCurrent(snapshot) &&
      !controller?.signal.aborted &&
      imageSnapshot.current === snapshot,
    [fieldsAreCurrent, identityIsCurrent],
  );

  useEffect(() => {
    if (!options.active) {
      setCapability(undefined);
      return;
    }
    const controller = new AbortController();
    void readArticleImageCapability(host, identity, controller.signal)
      .then((value) => {
        const current = host.getSession();
        if (
          controller.signal.aborted ||
          current.generation !== generation ||
          JSON.stringify(latest.current.identity) !== identityKey ||
          !latest.current.active
        )
          return;
        setCapability(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted && host.getSession().generation === generation)
          setError(failure instanceof Error ? failure.message : articleText().contentImage.configFailed);
      });
    return () => controller.abort();
  }, [generation, host, identity, identityKey, options.active]);

  useEffect(() => {
    const snapshot = imageSnapshot.current;
    if (snapshot && (snapshot.identityKey !== identityKey || snapshot.fieldsKey !== fieldsKey)) {
      cancel();
      clearResult();
      imageSnapshot.current = undefined;
      setSelection(undefined);
      setOpen(false);
      setError(articleText().contentImage.contentChanged);
    }
  }, [cancel, clearResult, fieldsKey, identityKey]);

  useEffect(() => {
    if (options.active) return;
    cancel();
    clearResult();
    imageSnapshot.current = undefined;
    setSelection(undefined);
    setOpen(false);
    setError('');
  }, [cancel, clearResult, options.active]);

  useEffect(
    () => () => {
      operation.current?.abort();
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
      latest.current.onBusyChange(false);
    },
    [],
  );

  const show = useCallback(
    async (currentSel: ArticleContentImageSelection) => {
      if (!latest.current.active || currentSel.source !== latest.current.fields.content) return;
      cancel();
      clearResult();
      setError('');
      const snapshot: ArticleContentImageSnapshot = {
        identity: cloneIdentity(latest.current.identity),
        identityKey: JSON.stringify(latest.current.identity),
        fields: { ...latest.current.fields },
        fieldsKey: JSON.stringify(latest.current.fields),
        selection: { ...currentSel },
      };
      imageSnapshot.current = snapshot;
      setSelection(snapshot.selection);
      setOpen(true);
      setPhase('loading');
      const controller = new AbortController();
      operation.current = controller;
      try {
        const available = await readArticleImageCapability(host, snapshot.identity, controller.signal);
        if (!identityIsCurrent(snapshot) || controller.signal.aborted) return;
        setCapability(available);
        if (!articleImageAvailable(available)) throw new Error(articleText().imageAI.unavailable);
        setModelId(
          available.models.find((model) => model.id === available.defaultModelId && model.imageEnabled)?.id ??
            available.models.find((model) => model.imageEnabled)?.id ??
            '',
        );
        const refIds = (available.contextFields ?? []).filter(
          (field) => field !== 'content' && Boolean(snapshot.fields[field]?.trim()),
        );
        setReferences(refIds);
        setInstruction('');
        setSize('auto');
        setQuality('auto');
        setUse(currentSel.start === currentSel.end ? 'append' : 'replace');
      } catch (failure) {
        if (!controller.signal.aborted && identityIsCurrent(snapshot))
          setError(failure instanceof Error ? failure.message : articleText().contentImage.configFailed);
      } finally {
        if (operation.current === controller) {
          operation.current = null;
          setPhase('idle');
        }
      }
    },
    [cancel, clearResult, host, identityIsCurrent],
  );

  const close = useCallback(() => {
    cancel();
    clearResult();
    imageSnapshot.current = undefined;
    setSelection(undefined);
    setOpen(false);
    setError('');
  }, [cancel, clearResult]);

  const stop = useCallback(() => {
    cancel();
    setError(articleText().contentImage.stopped);
  }, [cancel]);

  const generate = useCallback(async () => {
    const snapshot = imageSnapshot.current;
    const currentCapability = capability;
    if (!snapshot || !currentCapability || phase === 'generating' || !isCurrent(snapshot)) return;
    clearResult();
    setError('');
    setPhase('generating');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const latestCapability = await readArticleImageCapability(host, snapshot.identity, controller.signal);
      if (!isCurrent(snapshot, controller)) return;
      if (latestCapability.revision !== currentCapability.revision || !articleImageAvailable(latestCapability))
        throw new Error(articleText().contentImage.aiChanged);
      const request = createArticleContentImageRequest(
        host,
        latestCapability,
        snapshot.identity,
        snapshot.fields,
        snapshot.selection,
        modelId,
        references,
        instruction,
        size === 'custom' ? `${customWidth}x${customHeight}` : size,
        quality,
      );
      const blob = await generateAIImage(host, request, controller.signal);
      if (!isCurrent(snapshot, controller)) return;
      const next = {
        blob,
        url: URL.createObjectURL(blob),
        identityKey: snapshot.identityKey,
        fieldsKey: snapshot.fieldsKey,
      };
      resultRef.current = next;
      setResult(next);
      setCapability(latestCapability);
    } catch (failure) {
      if (!controller.signal.aborted && isCurrent(snapshot))
        setError(failure instanceof Error ? failure.message : articleText().contentImage.generateFailed);
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setPhase('idle');
      }
    }
  }, [
    capability,
    clearResult,
    customHeight,
    customWidth,
    host,
    instruction,
    isCurrent,
    modelId,
    phase,
    quality,
    references,
    size,
  ]);

  const apply = useCallback(async () => {
    const snapshot = imageSnapshot.current;
    const generated = resultRef.current;
    if (!snapshot || !generated || !identityIsCurrent(snapshot)) return false;
    if (use !== 'library' && !fieldsAreCurrent(snapshot)) {
      setError(articleText().contentImage.contentChangedApply);
      return false;
    }
    setPhase('applying');
    setError('');
    latest.current.onBusyChange(true);
    try {
      let file = generated.saved;
      if (!file) {
        latest.current.onStatus(articleText().contentImage.uploading);
        const uploadFile = new File([generated.blob], `article-ai-${Date.now()}.png`, { type: 'image/png' });
        const uploaded = await latest.current.uploadFile(uploadFile);
        if (!uploaded) throw new Error(articleText().contentImage.uploadFailed);
        file = uploaded;
        generated.saved = uploaded;
        setResult({ ...generated });
      }
      const applied = await latest.current.onUseFile(file, snapshot.selection, use);
      if (!applied) return false;
      close();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : articleText().contentImage.applyFailed);
      return false;
    } finally {
      setPhase('idle');
      latest.current.onBusyChange(false);
    }
  }, [close, fieldsAreCurrent, identityIsCurrent, use]);

  const busy = phase === 'generating' || phase === 'applying';

  return {
    open,
    capability,
    phase,
    busy,
    selection,
    error,
    setError,
    result,
    modelId,
    setModelId,
    size,
    setSize,
    customWidth,
    setCustomWidth,
    customHeight,
    setCustomHeight,
    quality,
    setQuality,
    instruction,
    setInstruction,
    references,
    setReferences,
    use,
    setUse,
    clearResult,
    show,
    close,
    stop,
    generate,
    apply,
  };
}
