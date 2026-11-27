import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { AIResultState } from '@xyzos/desk-ui';
import { useHost, useSession } from '../../host/HostProvider';
import { canUse, type PermissionOptions } from '../hooks/permission';
import { isAbort } from '../hooks/useRequest';
import type { AICapability } from './capability';
import type { FormAIIdentity } from './formAI';
import {
  createTextAIRequest,
  generateTextAI,
  readTextAICapability,
  replaceTextSelection,
  textSelection,
} from './textAI';
import type { TextSelection } from './textAI';
import { aiText } from './locale';

export interface TextAIOptions {
  editor: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  permission?: string;
  permissionOptions?: PermissionOptions;
  target?: string;
  field?: string;
  identity?: FormAIIdentity;
  allowEmpty?: boolean;
  wholeField?: boolean;
  /** 当前表单其他字段的值（按字段 id）；提供后面板显示“参考”并按原站表单合同发送。 */
  referenceValues?: Readonly<Record<string, string>>;
  contentLabel?: string;
  applyFeedback?: string;
  maxLength: number;
  /** Validate the complete resulting field before applying an AI replacement. */
  validate?: (value: string) => boolean;
  onBusyChange?: (value: boolean) => void;
}

export function useTextAI(options: TextAIOptions) {
  const host = useHost();
  const session = useSession();
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const [capability, setCapability] = useState<AICapability | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [state, setState] = useState<AIResultState>('idle');
  const [applying, setApplying] = useState(false);
  const [output, setOutput] = useState('');
  const [selection, setSelection] = useState<TextSelection>();
  const [undo, setUndo] = useState<{ before: string; after: string }>();
  const [action, setAction] = useState('');
  const [model, setModel] = useState('');
  const [language, setLanguage] = useState('');
  const [instruction, setInstruction] = useState('');
  const [reload, setReload] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const capabilityRevision = useRef<number | undefined>(undefined);
  const generation = session.generation;
  const permission = options.permission;
  const admin = options.permissionOptions?.admin === true;
  const targetID = options.target ?? 'text.selection';
  const fieldID = options.field ?? 'text';
  const identityKey = JSON.stringify(options.identity ?? {});
  const identity = useMemo(() => JSON.parse(identityKey) as FormAIIdentity, [identityKey]);
  const active = canUse(session, permission, { admin });
  const busy = applying || state === 'generating';
  const onBusyChange = options.onBusyChange;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const allowed = () => {
    const node = latest.current.editor.current;
    const current = latest.current;
    const currentIdentity = JSON.stringify(current.identity ?? {});
    const sameTarget =
      (current.target ?? 'text.selection') === targetID &&
      (current.field ?? 'text') === fieldID &&
      currentIdentity === identityKey;
    return (
      sameTarget &&
      host.getSession().generation === generation &&
      canUse(host.getSession(), permission, { admin }) &&
      !latest.current.disabled &&
      !!node?.isConnected &&
      !node.matches(':disabled') &&
      !node.readOnly
    );
  };

  useEffect(() => {
    setCapability(null);
    setError('');
    setFeedback('');
    setOutput('');
    setState('idle');
    setApplying(false);
    setSelection(undefined);
    setUndo(undefined);
    if (!active) return;
    const controller = new AbortController();
    let loading = false;
    capabilityRevision.current = undefined;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const value = await readTextAICapability(host, controller.signal, {
          target: targetID,
          identity,
        });
        if (controller.signal.aborted) return;
        const revision = capabilityRevision.current;
        if (revision !== undefined && value.revision < revision) return;
        if (revision !== undefined && revision !== value.revision) {
          pending.current?.abort();
          pending.current = null;
          setApplying(false);
          setOutput('');
          setState('idle');
          setSelection(undefined);
          setUndo(undefined);
          setError(aiText().configUpdatedAction);
        }
        capabilityRevision.current = value.revision;
        setCapability(value);
        setAction((previous) =>
          value.actions.some((item) => item.id === previous) ? previous : (value.actions[0]?.id ?? ''),
        );
        setModel((previous) =>
          value.models.some((item) => item.id === previous)
            ? previous
            : value.defaultModelId || value.models[0]?.id || '',
        );
        setLanguage((previous) =>
          value.languages.includes(previous) ? previous : value.language || value.languages[0] || '',
        );
      } catch (failure) {
        if (!controller.signal.aborted && !isAbort(failure)) setError(message(failure));
      } finally {
        loading = false;
      }
    };
    setInstruction('');
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60000);
    return () => {
      clearInterval(timer);
      controller.abort();
      pending.current?.abort();
      pending.current = null;
    };
  }, [active, fieldID, generation, host, identity, identityKey, reload, targetID]);

  useEffect(() => {
    if (!options.disabled) return;
    pending.current?.abort();
    pending.current = null;
    setOutput('');
    setState('idle');
    setApplying(false);
    setSelection(undefined);
    setUndo(undefined);
  }, [options.disabled]);

  function capture() {
    const node = latest.current.editor.current;
    return textSelection(latest.current.value, node?.selectionStart ?? undefined, node?.selectionEnd ?? undefined);
  }

  function captureWhole() {
    const value = latest.current.value;
    return textSelection(value, 0, value.length);
  }

  function commit(value: string, target = selection) {
    if (!allowed() || !target) return false;
    try {
      const before = latest.current.value;
      const contentLabel = latest.current.contentLabel ?? aiText().body;
      if (latest.current.editor.current?.value !== before) throw new Error(aiText().modifiedReselect(contentLabel));
      const next = replaceTextSelection(target, before, value, latest.current.maxLength, contentLabel);
      if (latest.current.validate && !latest.current.validate(next)) throw new Error(aiText().resultViolates);
      latest.current.onChange(next);
      setUndo({ before, after: next });
      setFeedback(latest.current.applyFeedback ?? aiText().appliedTo(contentLabel));
      setError('');
      setOutput('');
      setState('idle');
      const node = latest.current.editor.current;
      requestAnimationFrame(() => {
        if (!allowed() || !node?.isConnected || latest.current.value !== next) return;
        node.focus();
        node.setSelectionRange(target.start, target.start + value.length);
      });
      return true;
    } catch (failure) {
      setError(message(failure));
      setState('ready');
      return false;
    }
  }

  async function apply(value: string) {
    if (!allowed() || !selection || !capability || pending.current) return false;
    const controller = new AbortController();
    pending.current = controller;
    setApplying(true);
    try {
      const current = await readTextAICapability(host, controller.signal, {
        target: targetID,
        identity,
      });
      if (controller.signal.aborted || !allowed()) return false;
      if (
        current.revision !== capability.revision ||
        !current.enabled ||
        !current.textEnabled ||
        !current.textFields.includes(fieldID)
      )
        throw new Error(aiText().configChangedContentUntouched);
      return commit(value);
    } catch (failure) {
      if (!controller.signal.aborted && allowed()) {
        setError(message(failure));
        setState('error');
      }
      return false;
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setApplying(false);
      }
    }
  }

  async function generate(
    nextAction = action,
    quick = false,
    target = capture(),
    selectedReferences: readonly string[] = [],
  ) {
    if (!allowed() || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setSelection(target);
    setAction(nextAction);
    setState('generating');
    setError('');
    setFeedback('');
    setOutput('');
    try {
      if (target.source !== latest.current.value) throw new Error(aiText().bodyEditedReopen);
      // Refresh the original settings revision and model/action availability before each use.
      const current = await readTextAICapability(host, controller.signal, {
        target: targetID,
        identity,
      });
      if (controller.signal.aborted || !allowed()) return;
      capabilityRevision.current = current.revision;
      setCapability(current);
      const body = createTextAIRequest(
        host,
        current,
        target,
        nextAction,
        quick ? current.defaultModelId || current.models[0]?.id || '' : model,
        quick ? current.language : language,
        quick ? '' : instruction,
        {
          target: targetID,
          field: fieldID,
          identity,
          allowEmpty: latest.current.allowEmpty,
          references: latest.current.referenceValues
            ? { values: latest.current.referenceValues, selected: quick ? [] : selectedReferences }
            : undefined,
        },
      );
      const result = await generateTextAI(host, body, controller.signal, (value) => {
        if (allowed() && !controller.signal.aborted) setOutput(value);
      });
      if (controller.signal.aborted || !allowed()) return;
      const checked = await readTextAICapability(host, controller.signal, {
        target: targetID,
        identity,
      });
      if (controller.signal.aborted || !allowed()) return;
      if (
        checked.revision !== current.revision ||
        !checked.enabled ||
        !checked.textEnabled ||
        !checked.textFields.includes(fieldID)
      )
        throw new Error(aiText().configChangedContentUntouched);
      if (!quick || !commit(result, target)) setState(quick ? 'error' : 'ready');
    } catch (failure) {
      if (!controller.signal.aborted && allowed()) {
        setError(message(failure));
        setState('error');
      }
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }

  function stop() {
    pending.current?.abort();
    pending.current = null;
    setApplying(false);
    setError(aiText().stoppedGenerationNotApplied);
    setState('error');
  }

  function discard() {
    pending.current?.abort();
    pending.current = null;
    setApplying(false);
    setOutput('');
    setSelection(undefined);
    setState('idle');
    setError('');
  }

  function undoApply() {
    if (!allowed() || !undo || latest.current.value !== undo.after) return;
    latest.current.onChange(undo.before);
    setUndo(undefined);
    setFeedback(aiText().undone);
    latest.current.editor.current?.focus();
  }

  function cut(target: TextSelection) {
    if (!allowed() || latest.current.value !== target.source || latest.current.editor.current?.value !== target.source)
      return false;
    latest.current.onChange(target.source.slice(0, target.start) + target.source.slice(target.end));
    setUndo(undefined);
    return true;
  }

  return {
    capability,
    busy,
    applying,
    active,
    error,
    feedback,
    state,
    output,
    setOutput: (value: string) => {
      setOutput(value);
      if (state === 'ready') setError('');
    },
    selection,
    action,
    setAction,
    model,
    setModel,
    language,
    setLanguage,
    instruction,
    setInstruction,
    reload: () => setReload((value) => value + 1),
    canUndo: !!undo && options.value === undo.after,
    capture,
    captureWhole,
    generate,
    apply,
    stop,
    discard,
    undo: undoApply,
    cut,
  };
}

function message(failure: unknown) {
  return failure instanceof Error ? failure.message : aiText().textFailed;
}
