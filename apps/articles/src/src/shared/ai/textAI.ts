import type { OsHost } from '../../host/types';
import { platformAIComplete } from '../sdk/bridge';
import {
  buildArticleCapability,
  formatPlatformAIError,
  loadArticleAIModels,
  loadArticleAISettings,
  renderPromptTemplate,
  resolvePlatformModelId,
} from '../sdk/ai';
import type { AICapability } from './capability';
import type { FormAIIdentity } from './formAI';
import { aiText } from './locale';

export interface TextSelection {
  source: string;
  start: number;
  end: number;
  text: string;
}

export function createAIRequestId(host: Pick<OsHost, 'uuid'>) {
  return host
    .uuid()
    .replace(/[^a-f\d]/gi, '')
    .toLowerCase()
    .slice(0, 32)
    .padEnd(32, '0');
}

export function textSelection(source: string, start = 0, end = 0): TextSelection {
  let from = Math.max(0, Math.min(source.length, start));
  let to = Math.max(from, Math.min(source.length, end));
  if (from === to) {
    from = 0;
    to = source.length;
  }
  return { source, start: from, end: to, text: source.slice(from, to) };
}

export function replaceTextSelection(
  selection: TextSelection,
  source: string,
  result: string,
  limit: number,
  contentLabel = aiText().body,
) {
  if (source !== selection.source) throw new Error(aiText().modifiedReselect(contentLabel));
  if (!result.trim()) throw new Error(aiText().resultEmpty);
  const next = source.slice(0, selection.start) + result + source.slice(selection.end);
  if ([...next].length > limit) throw new Error(aiText().exceedsLimit(contentLabel, limit));
  return next;
}

export interface TextAITargetOptions {
  target?: string;
  field?: string;
  identity?: FormAIIdentity;
  allowEmpty?: boolean;
  references?: { values: Readonly<Record<string, string>>; selected: readonly string[] };
}

export interface TextAIRequestBody {
  target: string;
  field: string;
  action: string;
  text: string;
  language: string;
  instruction: string;
  fields: Record<string, string>;
  contextFields: string[];
  modelId: string;
  settingsRevision: number;
  requestId: string;
}

export async function readTextAICapability(
  _host: OsHost,
  signal: AbortSignal,
  _targetOptions: TextAITargetOptions = {},
): Promise<AICapability> {
  const [{ settings, revision }, models] = await Promise.all([
    loadArticleAISettings(signal),
    loadArticleAIModels(signal),
  ]);
  return buildArticleCapability(settings, revision, models);
}

export function createTextAIRequest(
  host: OsHost,
  capability: AICapability,
  selection: TextSelection,
  action: string,
  modelId: string,
  language: string,
  instruction: string,
  targetOptions: TextAITargetOptions = {},
): TextAIRequestBody {
  const target = targetOptions.target ?? 'text.selection';
  const field = targetOptions.field ?? 'text';
  if (!capability.enabled || !capability.textEnabled || !capability.textFields.includes(field))
    throw new Error(aiText().textDisabled);
  if (
    !capability.actions.some((entry) => entry.id === action) ||
    !capability.models.some((entry) => entry.id === modelId)
  )
    throw new Error(aiText().actionGone);
  if (!selection.text.trim() && !(targetOptions.allowEmpty && target !== 'text.selection' && instruction.trim()))
    throw new Error(aiText().needContent);

  const fields: Record<string, string> = {};
  const references = targetOptions.references;
  if (references) {
    for (const item of capability.fields) {
      const value = references.values[item.id];
      if (typeof value === 'string' && value !== '' && (!item.readOnly || references.selected.includes(item.id))) {
        fields[item.id] = value;
      }
    }
  }
  fields[field] = selection.source;

  return {
    target,
    field,
    action,
    text: selection.text,
    language,
    instruction,
    fields,
    contextFields: references
      ? references.selected.filter((id) => capability.referenceFields.includes(id) && id in fields)
      : [],
    modelId,
    settingsRevision: capability.revision,
    requestId: createAIRequestId(host),
  };
}

export async function buildTextAIPrompt(body: TextAIRequestBody, signal?: AbortSignal) {
  const { settings } = await loadArticleAISettings(signal);
  const contextParts: string[] = [];
  for (const key of body.contextFields) {
    const val = body.fields[key];
    if (val && val.trim()) contextParts.push(`[${key}]\n${val.slice(0, 4000)}`);
  }
  const contextText = contextParts.length ? contextParts.join('\n\n') : '无额外参考上下文';
  const templateByAction: Record<string, string> = {
    polish: settings.ai_prompt_polish,
    expand: settings.ai_prompt_expand,
    shorten: settings.ai_prompt_shorten,
    translate: settings.ai_prompt_translate,
    custom: settings.ai_prompt_custom,
  };
  const template = templateByAction[body.action] || settings.ai_prompt_custom;
  let user = renderPromptTemplate(template, {
    content: body.text,
    context: contextText,
    targetLanguage: body.language || '简体中文',
    instruction: body.instruction.trim() || '优化文本表达',
  });
  if (body.action !== 'custom' && body.instruction.trim()) {
    user += `\n\n补充要求：${body.instruction.trim()}`;
  }
  const system =
    '你是文章写作助手。保留原文中的 Markdown 语法与 article-file:<编号> 图片/附件引用不要破坏；只输出处理后的正文结果，不要附加多余解释。';
  return { system, user };
}

export async function generateTextAI(
  _host: OsHost,
  body: object,
  signal: AbortSignal,
  onDelta: (value: string) => void,
) {
  const req = body as TextAIRequestBody;
  const prompt = await buildTextAIPrompt(req, signal);
  try {
    const res = await platformAIComplete(
      {
        modelId: resolvePlatformModelId(req.modelId),
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        maxOutput: 4096,
        responseFormat: 'text',
      },
      signal,
    );
    if (signal.aborted) throw new DOMException(aiText().stopped, 'AbortError');
    const text = typeof res?.text === 'string' ? res.text.trim() : '';
    if (!text) throw new Error(aiText().incomplete);
    onDelta(text);
    return text;
  } catch (failure) {
    throw formatPlatformAIError(failure, aiText().generateFailed);
  }
}
