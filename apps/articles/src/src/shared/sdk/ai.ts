import { platformSettingsGet } from './bridge';
import type { FormAICapability, FormAIField } from '../ai/formAI';
import type { ArticleImageCapability } from '../../features/articles/articleImageAI';

export interface ArticleAISettings {
  ai_enabled: boolean;
  ai_image_enabled: boolean;
  ai_translate_languages: string;
  ai_prompt_polish: string;
  ai_prompt_expand: string;
  ai_prompt_shorten: string;
  ai_prompt_translate: string;
  ai_prompt_custom: string;
  ai_prompt_form: string;
  ai_image_style: string;
}

export const defaultArticleAISettings: ArticleAISettings = {
  ai_enabled: true,
  ai_image_enabled: true,
  ai_translate_languages: '简体中文, English, 日本語',
  ai_prompt_polish: '润色 {{content}}，使表达清晰自然，保留事实、格式与原意。参考 {{context}}。只返回处理后的内容。',
  ai_prompt_expand: '根据 {{context}} 扩写 {{content}}，补充结构与解释，不编造事实。只返回处理后的内容。',
  ai_prompt_shorten: '精简 {{content}}，保留关键信息与格式。参考 {{context}}。只返回处理后的内容。',
  ai_prompt_translate: '将 {{content}} 翻译成 {{targetLanguage}}，保留事实、格式与引用。参考 {{context}}。只返回译文。',
  ai_prompt_custom: '根据 {{instruction}} 处理 {{content}}。参考 {{context}}，保留事实与引用。只返回处理后的内容。',
  ai_prompt_form:
    '根据 {{formContext}} 和 {{existingFields}}，补全 {{requestedFields}}。遵循 {{instruction}}，不编造事实，按要求的 JSON 字段返回。',
  ai_image_style: '',
};

let cachedSettings: { value: ArticleAISettings; loadedAt: number; revision: number } | null = null;
let revisionCounter = 1;

function strSetting(raw: Record<string, unknown>, key: keyof ArticleAISettings, fallback: string): string {
  const val = raw[key];
  return typeof val === 'string' && val.trim() ? val.trim() : fallback;
}

function boolSetting(raw: Record<string, unknown>, key: keyof ArticleAISettings, fallback: boolean): boolean {
  const val = raw[key];
  return typeof val === 'boolean' ? val : fallback;
}

export async function loadArticleAISettings(signal?: AbortSignal): Promise<{ settings: ArticleAISettings; revision: number }> {
  const now = Date.now();
  if (cachedSettings && now - cachedSettings.loadedAt < 5000) {
    return { settings: cachedSettings.value, revision: cachedSettings.revision };
  }
  let raw: Record<string, unknown> = {};
  try {
    const res = await platformSettingsGet(signal);
    if (res && typeof res === 'object') raw = res;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    /* 降级使用清单默认配置 */
  }
  const value: ArticleAISettings = {
    ai_enabled: boolSetting(raw, 'ai_enabled', defaultArticleAISettings.ai_enabled),
    ai_image_enabled: boolSetting(raw, 'ai_image_enabled', defaultArticleAISettings.ai_image_enabled),
    ai_translate_languages: strSetting(raw, 'ai_translate_languages', defaultArticleAISettings.ai_translate_languages),
    ai_prompt_polish: strSetting(raw, 'ai_prompt_polish', defaultArticleAISettings.ai_prompt_polish),
    ai_prompt_expand: strSetting(raw, 'ai_prompt_expand', defaultArticleAISettings.ai_prompt_expand),
    ai_prompt_shorten: strSetting(raw, 'ai_prompt_shorten', defaultArticleAISettings.ai_prompt_shorten),
    ai_prompt_translate: strSetting(raw, 'ai_prompt_translate', defaultArticleAISettings.ai_prompt_translate),
    ai_prompt_custom: strSetting(raw, 'ai_prompt_custom', defaultArticleAISettings.ai_prompt_custom),
    ai_prompt_form: strSetting(raw, 'ai_prompt_form', defaultArticleAISettings.ai_prompt_form),
    ai_image_style: typeof raw.ai_image_style === 'string' ? raw.ai_image_style.trim() : '',
  };
  const changed = !cachedSettings || JSON.stringify(cachedSettings.value) !== JSON.stringify(value);
  const revision = changed ? ++revisionCounter : cachedSettings!.revision;
  cachedSettings = { value, loadedAt: now, revision };
  return { settings: value, revision };
}

export function renderPromptTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => vars[key] ?? '');
}

export function parseTranslateLanguages(raw: string): string[] {
  const list = raw
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? [...new Set(list)] : ['简体中文', 'English', '日本語'];
}

export function formatPlatformAIError(error: unknown, fallback: string): Error {
  if (error instanceof DOMException && error.name === 'AbortError') return error;
  const msg = error instanceof Error ? error.message : String(error || '');
  const lower = msg.toLowerCase();
  if (lower.includes('503') || lower.includes('未配置') || lower.includes('not configured')) {
    return new Error('系统未配置默认文本或生图模型，请在系统设置中完成配置后再试');
  }
  if (lower.includes('429') || lower.includes('限额') || lower.includes('quota') || lower.includes('rate')) {
    return new Error('已达到本应用今日 AI 调用限额，请明日再试或联系管理员调整限额');
  }
  if (lower.includes('403') || lower.includes('禁用') || lower.includes('disabled') || lower.includes('forbidden')) {
    return new Error('管理员已关闭本应用的 AI 能力，请在「应用管理」中开启');
  }
  return new Error(msg || fallback);
}

const articleFieldsSpec: FormAIField[] = [
  { id: 'title', name: '标题', format: 'text', maxLength: 160, multiline: false },
  { id: 'summary', name: '摘要', format: 'text', maxLength: 500, multiline: true },
  { id: 'content', name: '正文', format: 'markdown', maxLength: 80000, multiline: true },
  { id: 'category', name: '分类', format: 'choice', maxLength: 120, multiline: false, suggestable: true, optionsRequired: true },
  {
    id: 'tags',
    name: '标签',
    format: 'list',
    maxLength: 600,
    multiline: true,
    suggestable: true,
    maxItems: 12,
    itemMaxLength: 40,
    optionsRequired: true,
  },
  { id: 'visibility', name: '可见范围', format: 'choice', maxLength: 40, multiline: false, suggestable: true, optionsRequired: true },
];

export function buildArticleCapability(
  settings: ArticleAISettings,
  revision: number,
): ArticleImageCapability & FormAICapability {
  const languages = parseTranslateLanguages(settings.ai_translate_languages);
  return {
    enabled: settings.ai_enabled || settings.ai_image_enabled,
    promptPreviewEnabled: true,
    textEnabled: settings.ai_enabled,
    formEnabled: settings.ai_enabled,
    imageEnabled: settings.ai_image_enabled,
    revision,
    actions: [
      { id: 'polish', name: '润色' },
      { id: 'expand', name: '扩写' },
      { id: 'shorten', name: '精简' },
      { id: 'translate', name: '翻译' },
      { id: 'custom', name: '自定义' },
    ],
    models: [{ id: 'platform-default', name: '系统默认模型', imageEnabled: settings.ai_image_enabled }],
    defaultModelId: 'platform-default',
    fields: articleFieldsSpec,
    languages,
    language: languages[0] ?? '简体中文',
    referenceFields: ['title', 'summary', 'content', 'category', 'tags', 'visibility'],
    contextFields: ['title', 'summary', 'content', 'category', 'tags'],
    textFields: ['content', 'text'],
    writeFields: ['title', 'summary', 'content', 'category', 'tags', 'visibility'],
    generateFields: ['title', 'summary', 'content', 'category', 'tags', 'visibility'],
    imageFields: ['content'],
  };
}
