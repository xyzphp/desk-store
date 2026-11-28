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
import { createAIRequestId } from './textAI';
import { aiText } from './locale';

export interface FormAIField {
  id: string;
  name: string;
  format: string;
  maxLength: number;
  multiline: boolean;
  readOnly?: boolean;
  suggestable?: boolean;
  itemMaxLength?: number;
  maxItems?: number;
  optionsRequired?: boolean;
}

export interface FormAICapability extends AICapability {
  formEnabled: boolean;
  fields: FormAIField[];
  contextFields: string[];
  referenceFields: string[];
  writeFields: string[];
  generateFields?: string[];
  emptyOnly?: boolean;
}

export interface FormAIIdentity {
  recordId?: number;
  projectId?: number;
  revision?: number;
  cardId?: string;
  templateId?: string;
  conversationId?: string;
  sourceId?: string;
}

export interface FormAIRequestOptions {
  target: string;
  identity: FormAIIdentity;
  capability: FormAICapability;
  fields: Readonly<Record<string, string>>;
  requestedFields: readonly string[];
  contextFields: readonly string[];
  referenceOptions?: Readonly<Record<string, readonly string[]>>;
  modelId: string;
  language: string;
  instruction: string;
}

export interface FormAIRequestBody {
  target: string;
  modelId: string;
  identity: FormAIIdentity;
  settingsRevision: number;
  requestId: string;
  fields: Record<string, string>;
  requestedFields: string[];
  rewriteFields: string[];
  contextFields: string[];
  instruction: string;
  language: string;
  fieldOptions?: Record<string, string[]>;
}

export async function readFormAICapability(
  _host: OsHost,
  _target: string,
  _identity: FormAIIdentity,
  signal: AbortSignal,
): Promise<FormAICapability> {
  const [{ settings, revision }, models] = await Promise.all([
    loadArticleAISettings(signal),
    loadArticleAIModels(signal),
  ]);
  return buildArticleCapability(settings, revision, models);
}

export function createFormAIRequest(host: OsHost, options: FormAIRequestOptions): FormAIRequestBody {
  const { target, identity, capability } = options;
  const requested = [...new Set(options.requestedFields)];
  const references = [...new Set(options.contextFields)];
  const allowedToGenerate = capability.generateFields ?? capability.writeFields;
  if (
    !capability.enabled ||
    !capability.formEnabled ||
    !options.modelId ||
    !capability.models.some((model) => model.id === options.modelId)
  )
    throw new Error(aiText().formUnavailable);
  if (!requested.length || requested.some((field) => !allowedToGenerate.includes(field)))
    throw new Error(aiText().pickAllowedFields);
  if (references.some((field) => !capability.referenceFields.includes(field))) throw new Error(aiText().referenceGone);
  if (options.instruction.length > 2000) throw new Error(aiText().instructionTooLong);
  if (!references.length && !options.instruction.trim()) throw new Error(aiText().needInstruction);
  if (options.language && !capability.languages.includes(options.language)) throw new Error(aiText().languageChanged);

  const fieldMap = new Map(capability.fields.map((field) => [field.id, field]));
  for (const key of requested)
    if (!fieldMap.has(key) || typeof options.fields[key] !== 'string') throw new Error(aiText().snapshotInvalid);
  const fields = Object.fromEntries(
    Object.entries(options.fields).filter(([key]) => {
      const field = fieldMap.get(key);
      return !!field && (!field.readOnly || references.includes(key) || requested.includes(key));
    }),
  );
  const fieldOptions = Object.fromEntries(
    requested
      .filter((key) => {
        const field = fieldMap.get(key)!;
        return field.suggestable && (options.referenceOptions?.[key]?.length ?? 0) > 0;
      })
      .map((key) => [key, [...options.referenceOptions![key]!]]),
  );
  return {
    target,
    modelId: options.modelId,
    identity,
    settingsRevision: capability.revision,
    requestId: createAIRequestId(host),
    fields,
    requestedFields: requested,
    rewriteFields: requested.filter((key) => !!options.fields[key]?.trim()),
    contextFields: references,
    instruction: options.instruction,
    language: options.language,
    ...(Object.keys(fieldOptions).length ? { fieldOptions } : {}),
  };
}

const protectedReferences = (value: string) =>
  [...value.matchAll(/(?:article-file|project-file):[1-9][0-9]*/g)].map((match) => match[0]).sort();
const protectedMedia = (value: string) =>
  [
    ...value.matchAll(
      /!?\[[^\]\r\n]*\]\((?:article-file|project-file):[1-9][0-9]*(?:[ \t]+"[^"\r\n]*")?(?:[ \t]+=[0-9]{2,4})?\)/g,
    ),
  ]
    .map((match) => match[0])
    .sort();
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function validFormAIValue(
  field: FormAIField,
  value: string,
  original: string,
  options: readonly string[] = [],
  emptyOnly = false,
) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    [...value].length > field.maxLength ||
    /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(value) ||
    (!field.multiline && /[\n\t]/.test(value)) ||
    !same(protectedReferences(value), protectedReferences(original)) ||
    !same(protectedMedia(value), protectedMedia(original)) ||
    (emptyOnly && original.trim() && value !== original)
  )
    return false;
  if (!field.suggestable) return true;
  if (field.format === 'choice') return options.includes(value);
  if (field.format !== 'list') return false;
  const values = value.split('\n');
  return (
    values.length > 0 &&
    (!field.maxItems || values.length <= field.maxItems) &&
    values.every(
      (item, index) =>
        item &&
        item.trim() === item &&
        [...item].length <= (field.itemMaxLength || field.maxLength) &&
        values.indexOf(item) === index &&
        (!field.optionsRequired || options.includes(item)),
    )
  );
}

export function validateFormAIChanges(
  capability: FormAICapability,
  requestedFields: readonly string[],
  rewriteFields: readonly string[],
  currentFields: Readonly<Record<string, string>>,
  options: Readonly<Record<string, readonly string[]>>,
  changes: unknown,
) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return false;
  const result = changes as Record<string, unknown>;
  if (!same(Object.keys(result).sort(), [...requestedFields].sort())) return false;
  return requestedFields.every((key) => {
    const field = capability.fields.find((item) => item.id === key);
    const value = result[key];
    return (
      !!field &&
      typeof value === 'string' &&
      validFormAIValue(
        field,
        value,
        currentFields[key] ?? '',
        options[key] ?? [],
        capability.emptyOnly === true && !!currentFields[key]?.trim() && !rewriteFields.includes(key),
      )
    );
  });
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1]! : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const slice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  const parsed = JSON.parse(slice);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(aiText().formResultInvalid);
  }
  return parsed as Record<string, unknown>;
}

export async function generateFormAI(
  _host: OsHost,
  body: object,
  signal: AbortSignal,
): Promise<Record<string, string>> {
  const req = body as FormAIRequestBody;
  const { settings } = await loadArticleAISettings(signal);
  const existingLines = req.contextFields
    .map((key) => (req.fields[key] ? `${key}: ${req.fields[key]!.slice(0, 6000)}` : ''))
    .filter(Boolean);
  const optionLines = Object.entries(req.fieldOptions ?? {}).map(
    ([key, opts]) => `- ${key} 必须从以下候选值中严格选择：${JSON.stringify(opts)}`,
  );
  const userPrompt = [
    renderPromptTemplate(settings.ai_prompt_form, {
      formContext: '文章编辑表单（包含标题 title、摘要 summary、正文 content、分类 category、标签 tags、可见范围 visibility）',
      existingFields: existingLines.join('\n\n') || '无已有内容',
      requestedFields: req.requestedFields.join(', '),
      instruction: req.instruction.trim() || '自然、准确地补全所选字段',
    }),
    optionLines.length ? `候选约束：\n${optionLines.join('\n')}` : '',
    `输出格式要求：严格返回一个 JSON 对象，只包含键 ${JSON.stringify(req.requestedFields)}；其中 tags 字段用换行符 \\n 分隔多个标签名，其余字段均为字符串。不要输出任何多余解释或 Markdown 代码块以外的文字。`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const res = await platformAIComplete(
      {
        modelId: resolvePlatformModelId(req.modelId),
        system:
          '你是文章表单智能补全助手。严格按要求的 JSON 对象返回字段值；不得改动正文中的 article-file:<编号> 媒体引用。',
        messages: [{ role: 'user', content: userPrompt }],
        maxOutput: 4096,
        responseFormat: 'json',
      },
      signal,
    );
    if (signal.aborted) throw new DOMException(aiText().formGenerateCancelled, 'AbortError');
    const obj = parseJsonObject(res?.text ?? '');
    const out: Record<string, string> = {};
    for (const key of req.requestedFields) {
      const raw = obj[key];
      if (Array.isArray(raw)) {
        out[key] = raw.map((v) => String(v).trim()).filter(Boolean).join('\n');
      } else if (typeof raw === 'string') {
        out[key] = raw.trim();
      } else {
        throw new Error(aiText().formResultInvalid);
      }
    }
    return out;
  } catch (failure) {
    throw formatPlatformAIError(failure, aiText().formGenerateFailed);
  }
}
