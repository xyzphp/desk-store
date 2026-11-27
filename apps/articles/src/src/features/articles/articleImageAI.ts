import type { OsHost } from '../../host/types';
import { readFormAICapability, type FormAICapability, type FormAIIdentity } from '../../shared/ai/formAI';
import { createAIRequestId } from '../../shared/ai/textAI';
import { articleText } from './locale';

export type ArticleCoverFormat = 'banner' | 'square';
export type ArticleImageQuality = 'auto' | 'low' | 'medium' | 'high';

export const articleCoverSpecs = {
  banner: { width: 900, height: 383, generationSize: '1536x656' },
  square: { width: 500, height: 500, generationSize: '1024x1024' },
} as const;

export interface ArticleImageCapability extends FormAICapability {
  imageEnabled: boolean;
  imageFields: string[];
  models: Array<FormAICapability['models'][number] & { imageEnabled: boolean }>;
}

export interface ArticleImageSnapshot {
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string;
  visibility: string;
}

export function articleImageSnapshotKey(value: ArticleImageSnapshot) {
  return JSON.stringify(value);
}

export async function readArticleImageCapability(
  host: OsHost,
  identity: FormAIIdentity,
  signal: AbortSignal,
): Promise<ArticleImageCapability> {
  const capability = await readFormAICapability(host, 'article.form', identity, signal);
  const raw = capability as FormAICapability & {
    imageEnabled?: unknown;
    imageFields?: unknown;
    models: Array<FormAICapability['models'][number] & { imageEnabled?: unknown }>;
  };
  if (
    raw.imageFields !== undefined &&
    (!Array.isArray(raw.imageFields) || raw.imageFields.some((field) => typeof field !== 'string'))
  )
    throw new Error(articleText().imageAI.configFormatError);
  return {
    ...raw,
    imageEnabled: raw.imageEnabled === true,
    imageFields: (raw.imageFields ?? []) as string[],
    models: raw.models.map((model) => ({
      ...model,
      imageEnabled: (model as { imageEnabled?: unknown }).imageEnabled === true,
    })),
  };
}

export function articleImageAvailable(capability: ArticleImageCapability | undefined) {
  return !!(
    capability?.enabled &&
    capability.imageEnabled &&
    capability.imageFields.includes('content') &&
    capability.fields.some((field) => field.id === 'content' && field.format === 'markdown') &&
    capability.models.some((model) => model.imageEnabled)
  );
}

export const articleImageQualityKeys = [
  'auto',
  'low',
  'medium',
  'high',
] as const satisfies readonly ArticleImageQuality[];

export const articleImageSizeKeys = ['auto', '1024x1024', '1536x1152', '1536x1024', '1024x1536', 'custom'] as const;

export function defaultArticleImageReferences(capability: ArticleImageCapability) {
  const fieldMap = new Map(capability.fields.map((field) => [field.id, field]));
  return capability.contextFields.filter((field) => !fieldMap.get(field)?.readOnly);
}

export function createArticleCoverRequest(
  host: OsHost,
  capability: ArticleImageCapability,
  identity: FormAIIdentity,
  format: ArticleCoverFormat,
  modelId: string,
  quality: ArticleImageQuality,
  instruction: string,
  requestedFields: readonly string[],
  values: ArticleImageSnapshot,
) {
  if (!articleImageAvailable(capability)) throw new Error(articleText().imageAI.unavailable);
  if (!capability.models.some((model) => model.id === modelId && model.imageEnabled))
    throw new Error(articleText().imageAI.modelUnavailable);
  if (!articleImageQualityKeys.includes(quality)) throw new Error(articleText().imageAI.qualityInvalid);
  if (instruction.length > 4000) throw new Error(articleText().imageAI.instructionTooLong);
  const contextFields = [...new Set(requestedFields)].filter(
    (field) =>
      capability.contextFields.includes(field) &&
      typeof values[field as keyof ArticleImageSnapshot] === 'string' &&
      !!values[field as keyof ArticleImageSnapshot].trim(),
  );
  if (!contextFields.length && !instruction.trim()) throw new Error(articleText().imageAI.needReferenceOrInstruction);
  return {
    target: 'article.form',
    modelId,
    identity,
    settingsRevision: capability.revision,
    requestId: createAIRequestId(host),
    field: 'content',
    context: '',
    fields: Object.fromEntries(contextFields.map((field) => [field, values[field as keyof ArticleImageSnapshot]])),
    contextFields,
    instruction,
    size: articleCoverSpecs[format].generationSize,
    quality,
  };
}

export function validArticleImageSize(value: string) {
  if (value === 'auto') return true;
  const match = /^([1-9][0-9]{0,3})x([1-9][0-9]{0,3})$/.exec(value);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width <= 3840 && height <= 3840 && Math.max(width, height) <= 3 * Math.min(width, height);
}

export function createArticleContentImageRequest(
  host: OsHost,
  capability: ArticleImageCapability,
  identity: FormAIIdentity,
  fields: Readonly<Record<string, string>>,
  selection: { source: string; start: number; end: number; caret: number },
  modelId: string,
  requestedReferences: readonly string[],
  instruction: string,
  size: string,
  quality: ArticleImageQuality,
) {
  if (!articleImageAvailable(capability)) throw new Error(articleText().imageAI.unavailable);
  if (!capability.models.some((model) => model.id === modelId && model.imageEnabled))
    throw new Error(articleText().imageAI.modelUnavailable);
  if (!articleImageQualityKeys.includes(quality)) throw new Error(articleText().imageAI.qualityInvalid);
  if (!validArticleImageSize(size)) throw new Error(articleText().imageAI.sizeInvalid);
  if (instruction.length > 4000) throw new Error(articleText().imageAI.instructionTooLong);
  const context = selection.source.slice(selection.start, selection.end);
  const contextFields = [...new Set(requestedReferences)].filter(
    (field) =>
      capability.contextFields.includes(field) && typeof fields[field] === 'string' && Boolean(fields[field]?.trim()),
  );
  if (!context.trim() && !contextFields.length && !instruction.trim())
    throw new Error(articleText().imageAI.needSelectionOrReference);
  return {
    target: 'article.form',
    modelId,
    identity,
    settingsRevision: capability.revision,
    requestId: createAIRequestId(host),
    field: 'content',
    context,
    fields: Object.fromEntries(contextFields.map((field) => [field, fields[field] ?? ''])),
    contextFields,
    instruction,
    size,
    quality,
  };
}
