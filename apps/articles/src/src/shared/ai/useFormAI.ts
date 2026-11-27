import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useHost, useSession } from '../../host/HostProvider';
import { useSessionGuard } from '../hooks/useSessionGuard';
import { canUse, type PermissionOptions } from '../hooks/permission';
import {
  createFormAIRequest,
  generateFormAI,
  readFormAICapability,
  validateFormAIChanges,
  type FormAICapability,
  type FormAIIdentity,
} from './formAI';
import { aiText } from './locale';

export interface FormAIOptions {
  active?: boolean;
  target: string;
  identity: FormAIIdentity;
  fields: Readonly<Record<string, string>>;
  referenceOptions?: Readonly<Record<string, readonly string[]>>;
  permission: string;
  permissionOptions?: PermissionOptions;
  canEdit: () => boolean;
  /** Apply to the page-owned draft only. This callback must not save the form. */
  onApply: (changes: Record<string, string>, before: Readonly<Record<string, string>>) => boolean;
}

interface FormAIUndo {
  identity: string;
  before: Record<string, string>;
  after: Record<string, string>;
  keys: string[];
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const errorText = (failure: unknown) => (failure instanceof Error ? failure.message : aiText().formFailed);
const aborted = (failure: unknown) => failure instanceof DOMException && failure.name === 'AbortError';

export function useFormAI(options: FormAIOptions) {
  const host = useHost();
  const session = useSession();
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const identity = JSON.stringify(options.identity);
  const identityValue = useMemo(() => JSON.parse(identity) as FormAIIdentity, [identity]);
  const target = options.target;
  const canEditOption = options.canEdit;
  const active =
    options.active !== false &&
    session.status === 'ready' &&
    canUse(session, options.permission, options.permissionOptions);
  const [capability, setCapability] = useState<FormAICapability | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [state, setState] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [model, setModel] = useState('');
  const [language, setLanguage] = useState('');
  const [instruction, setInstruction] = useState('');
  const [requestedFields, setRequestedFields] = useState<string[]>([]);
  const [contextFields, setContextFields] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});
  const [selectedResults, setSelectedResults] = useState<string[]>([]);
  const [undoData, setUndoData] = useState<FormAIUndo | null>(null);
  const pending = useRef<AbortController | null>(null);
  const resultSource = useRef<{ identity: string; fields: Record<string, string> } | null>(null);
  const capabilityRevision = useRef<number | undefined>(undefined);
  const sequence = useRef(0);

  const allowed = useCallback(() => {
    const current = host.getSession();
    return (
      latest.current.active !== false &&
      current.status === 'ready' &&
      current.generation === session.generation &&
      canUse(current, latest.current.permission, latest.current.permissionOptions) &&
      latest.current.canEdit()
    );
  }, [host, session.generation]);

  useSessionGuard(() => {
    pending.current?.abort();
    pending.current = null;
    resultSource.current = null;
    setUndoData(null);
    sequence.current++;
    setCapability(null);
    setError('');
    setFeedback('');
    setState('idle');
    setResults({});
    setSelectedResults([]);
    setRequestedFields([]);
    setContextFields([]);
    setInstruction('');
  });

  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    resultSource.current = null;
    sequence.current++;
    setUndoData(null);
    setCapability(null);
    setError('');
    setFeedback('');
    setState('idle');
    setResults({});
    setSelectedResults([]);
    setRequestedFields([]);
    setContextFields([]);
    setInstruction('');
    if (!active) return;
    const controller = new AbortController();
    const currentSequence = sequence.current;
    let loading = false;
    capabilityRevision.current = undefined;
    const refresh = async () => {
      if (loading || controller.signal.aborted) return;
      loading = true;
      try {
        const value = await readFormAICapability(host, target, identityValue, controller.signal);
        if (controller.signal.aborted || currentSequence !== sequence.current) return;
        const prior = capabilityRevision.current;
        if (prior !== undefined && prior !== value.revision) {
          pending.current?.abort();
          pending.current = null;
          setResults({});
          setSelectedResults([]);
          setState('idle');
          setError(aiText().configUpdatedFields);
        }
        capabilityRevision.current = value.revision;
        setCapability(value);
        setModel((previous) =>
          value.models.some((item) => item.id === previous)
            ? previous
            : value.defaultModelId || value.models[0]?.id || '',
        );
        setLanguage((previous) =>
          value.languages.includes(previous) ? previous : value.language || value.languages[0] || '',
        );
      } catch (failure) {
        if (!controller.signal.aborted && currentSequence === sequence.current && !aborted(failure))
          setError(errorText(failure));
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
      pending.current?.abort();
      pending.current = null;
    };
  }, [active, host, identity, identityValue, session.generation, target]);

  const editable = canEditOption();
  useEffect(() => {
    if (active && editable) return;
    pending.current?.abort();
    pending.current = null;
    setResults({});
    setSelectedResults([]);
    setState('idle');
    setFeedback('');
  }, [active, editable]);

  const fieldsSnapshot = JSON.stringify(options.fields);
  useEffect(() => {
    const source = resultSource.current;
    if (!source || (source.identity === identity && same(source.fields, latest.current.fields))) return;
    resultSource.current = null;
    setResults({});
    setSelectedResults([]);
    setState('idle');
    setError(aiText().formChangedRegenerate);
    setFeedback('');
  }, [fieldsSnapshot, identity]);

  const canUndo =
    !!undoData &&
    undoData.identity === identity &&
    undoData.keys.every((key) => options.fields[key] === undoData.after[key]);

  const stop = () => {
    pending.current?.abort();
    pending.current = null;
    sequence.current++;
    setState('idle');
    setError('');
    resultSource.current = null;
    setFeedback(aiText().stoppedNotApplied);
  };

  const discard = () => {
    stop();
    setResults({});
    setSelectedResults([]);
    setRequestedFields([]);
    setInstruction('');
    setError('');
    setFeedback('');
  };

  const generate = async (nextRequested = requestedFields, nextContext = contextFields) => {
    if (!allowed() || !capability || pending.current) return;
    const source = { ...latest.current.fields };
    const sourceIdentity = identity;
    resultSource.current = null;
    const operation = new AbortController();
    const currentSequence = ++sequence.current;
    pending.current = operation;
    setRequestedFields([...nextRequested]);
    setContextFields([...nextContext]);
    setState('generating');
    setError('');
    setFeedback('');
    setResults({});
    setSelectedResults([]);
    try {
      const latestCapability = await readFormAICapability(
        host,
        latest.current.target,
        latest.current.identity,
        operation.signal,
      );
      if (operation.signal.aborted || currentSequence !== sequence.current || !allowed()) return;
      if (
        latestCapability.revision !== capability.revision ||
        !latestCapability.enabled ||
        !latestCapability.formEnabled
      )
        throw new Error(aiText().configChangedReload);
      if (!same(source, latest.current.fields) || sourceIdentity !== JSON.stringify(latest.current.identity))
        throw new Error(aiText().formEditedRegenerate);
      const body = createFormAIRequest(host, {
        target: latest.current.target,
        identity: latest.current.identity,
        capability: latestCapability,
        fields: source,
        requestedFields: nextRequested,
        contextFields: nextContext,
        referenceOptions: latest.current.referenceOptions,
        modelId: model,
        language,
        instruction,
      });
      const generated = await generateFormAI(host, body, operation.signal);
      if (operation.signal.aborted || currentSequence !== sequence.current || !allowed()) return;
      if (!same(source, latest.current.fields) || sourceIdentity !== JSON.stringify(latest.current.identity))
        throw new Error(aiText().formEditedNotApplied);
      const rewriteFields = nextRequested.filter((key) => !!source[key]?.trim());
      if (
        !validateFormAIChanges(
          latestCapability,
          nextRequested,
          rewriteFields,
          source,
          latest.current.referenceOptions ?? {},
          generated,
        )
      )
        throw new Error(aiText().fieldsViolate);
      setCapability(latestCapability);
      resultSource.current = { identity: sourceIdentity, fields: source };
      setResults(generated);
      setSelectedResults([...nextRequested]);
      setState('ready');
    } catch (failure) {
      if (!operation.signal.aborted && currentSequence === sequence.current && allowed()) {
        setError(errorText(failure));
        setState('error');
      }
    } finally {
      if (pending.current === operation) pending.current = null;
    }
  };

  const apply = async () => {
    if (!allowed() || !capability || state !== 'ready' || pending.current || !selectedResults.length) return false;
    const generatedFor = resultSource.current;
    if (!generatedFor || generatedFor.identity !== identity || !same(generatedFor.fields, latest.current.fields)) {
      resultSource.current = null;
      setResults({});
      setSelectedResults([]);
      setState('idle');
      setError(aiText().formChangedRegenerate);
      return false;
    }
    const source = { ...latest.current.fields };
    const sourceIdentity = identity;
    const changes = Object.fromEntries(selectedResults.map((key) => [key, results[key] ?? '']));
    const operation = new AbortController();
    pending.current = operation;
    setState('generating');
    setError('');
    try {
      const current = await readFormAICapability(
        host,
        latest.current.target,
        latest.current.identity,
        operation.signal,
      );
      if (operation.signal.aborted || !allowed()) return false;
      if (current.revision !== capability.revision || !current.enabled || !current.formEnabled)
        throw new Error(aiText().configChangedFormUntouched);
      if (!same(source, latest.current.fields) || sourceIdentity !== JSON.stringify(latest.current.identity))
        throw new Error(aiText().formEditedNotApplied);
      const rewriteFields = selectedResults.filter((key) => !!source[key]?.trim());
      if (
        !validateFormAIChanges(
          current,
          selectedResults,
          rewriteFields,
          source,
          latest.current.referenceOptions ?? {},
          changes,
        )
      )
        throw new Error(aiText().suggestionViolates);
      if (!latest.current.onApply(changes, source)) throw new Error(aiText().cannotApply);
      resultSource.current = null;
      setUndoData({
        identity: sourceIdentity,
        before: Object.fromEntries(selectedResults.map((key) => [key, source[key] ?? ''])),
        after: Object.fromEntries(selectedResults.map((key) => [key, changes[key]!])),
        keys: [...selectedResults],
      });
      setFeedback(aiText().appliedToDraft);
      setState('idle');
      return true;
    } catch (failure) {
      if (!operation.signal.aborted && allowed()) {
        setError(errorText(failure));
        setState('error');
      }
      return false;
    } finally {
      if (pending.current === operation) pending.current = null;
    }
  };

  const undoApply = () => {
    const prior = undoData;
    if (
      !allowed() ||
      !prior ||
      prior.identity !== identity ||
      !prior.keys.every((key) => latest.current.fields[key] === prior.after[key])
    ) {
      setError(aiText().cannotUndo);
      return false;
    }
    if (!latest.current.onApply(prior.before, latest.current.fields)) return false;
    setUndoData(null);
    setError('');
    setFeedback(aiText().undone);
    return true;
  };

  return {
    active,
    allowed: active && editable,
    capability,
    error,
    feedback,
    state,
    busy: state === 'generating',
    model,
    setModel,
    language,
    setLanguage,
    instruction,
    setInstruction,
    requestedFields,
    setRequestedFields,
    contextFields,
    setContextFields,
    results,
    setResult: (key: string, value: string) => setResults((current) => ({ ...current, [key]: value })),
    selectedResults,
    setSelectedResults,
    canUndo,
    generate,
    apply,
    undo: undoApply,
    stop,
    discard,
  };
}
