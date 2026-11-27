import { useEffect, useRef, useState } from 'react';
import { useHost } from '../../host/HostProvider';
import type { AICapability } from './capability';
import { buildTextAIPrompt, createTextAIRequest, type TextAITargetOptions, type TextSelection } from './textAI';
import { aiText } from './locale';

export interface TextAIPromptArgs {
  capability: AICapability | null;
  selection: TextSelection | undefined;
  action: string;
  model: string;
  language: string;
  instruction: string;
  targetOptions?: TextAITargetOptions;
  disabled?: boolean;
}

export function useTextAIPrompt({
  capability,
  selection,
  action,
  model,
  language,
  instruction,
  targetOptions,
  disabled,
}: TextAIPromptArgs) {
  const host = useHost();
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const targetOptionsKey = JSON.stringify(targetOptions ?? {});

  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setContent('');
    setError('');
    setBusy(false);
    return () => pending.current?.abort();
  }, [action, capability?.revision, host, instruction, language, model, selection, targetOptionsKey]);

  async function preview() {
    if (disabled || pending.current || !capability?.promptPreviewEnabled || !selection) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const body = createTextAIRequest(
        host,
        capability,
        selection,
        action,
        model,
        language,
        instruction,
        targetOptions,
      );
      const rendered = await buildTextAIPrompt(body, controller.signal);
      if (controller.signal.aborted) return;
      setContent(aiText().promptPreview(rendered.system, rendered.user));
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : aiText().promptFailed);
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  return {
    content,
    error,
    busy,
    preview: () => void preview(),
    close: () => {
      pending.current?.abort();
      pending.current = null;
      setBusy(false);
      setContent('');
      setError('');
    },
  };
}
