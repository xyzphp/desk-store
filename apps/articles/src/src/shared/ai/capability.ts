export interface AICapability {
  enabled: boolean;
  promptPreviewEnabled?: boolean;
  textEnabled: boolean;
  revision: number;
  actions: { id: string; name: string }[];
  models: { id: string; name: string }[];
  defaultModelId: string;
  fields: { id: string; name: string; readOnly?: boolean; format?: string }[];
  languages: string[];
  language: string;
  referenceFields: string[];
  textFields: string[];
}

export function isAICapability(value: unknown): value is AICapability {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AICapability>;
  return (
    typeof item.enabled === 'boolean' &&
    (item.promptPreviewEnabled === undefined || typeof item.promptPreviewEnabled === 'boolean') &&
    typeof item.textEnabled === 'boolean' &&
    Number.isSafeInteger(item.revision) &&
    Array.isArray(item.actions) &&
    item.actions.every((action) => typeof action?.id === 'string' && typeof action.name === 'string') &&
    Array.isArray(item.models) &&
    item.models.every((model) => typeof model?.id === 'string' && typeof model.name === 'string') &&
    typeof item.defaultModelId === 'string' &&
    Array.isArray(item.fields) &&
    item.fields.every(
      (field) =>
        typeof field?.id === 'string' &&
        typeof field.name === 'string' &&
        (field.readOnly === undefined || typeof field.readOnly === 'boolean') &&
        (field.format === undefined || typeof field.format === 'string'),
    ) &&
    Array.isArray(item.languages) &&
    item.languages.every((language) => typeof language === 'string') &&
    typeof item.language === 'string' &&
    Array.isArray(item.referenceFields) &&
    item.referenceFields.every((field) => typeof field === 'string') &&
    Array.isArray(item.textFields) &&
    item.textFields.every((field) => typeof field === 'string')
  );
}
