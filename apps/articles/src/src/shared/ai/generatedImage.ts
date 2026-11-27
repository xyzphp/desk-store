import type { OsHost } from '../../host/types';
import { base64ToBytes, platformAIImage } from '../sdk/bridge';
import { formatPlatformAIError, loadArticleAISettings } from '../sdk/ai';
import { aiText } from './locale';

interface ImageRequestPayload {
  context?: string;
  fields?: Record<string, string>;
  contextFields?: string[];
  instruction?: string;
  size?: string;
  quality?: string;
}

export async function generateAIImage(_host: OsHost, body: object, signal: AbortSignal): Promise<Blob> {
  const req = body as ImageRequestPayload;
  const { settings } = await loadArticleAISettings(signal);
  const parts: string[] = [];
  if (req.fields && req.contextFields?.length) {
    for (const key of req.contextFields) {
      const val = req.fields[key]?.trim();
      if (val) parts.push(`${key}: ${val.slice(0, 800)}`);
    }
  }
  if (req.context?.trim()) {
    parts.push(`相关片段：${req.context.trim().slice(0, 800)}`);
  }
  if (req.instruction?.trim()) {
    parts.push(`画面要求：${req.instruction.trim()}`);
  }
  if (settings.ai_image_style) {
    parts.push(`风格：${settings.ai_image_style}`);
  }
  const prompt = parts.join('\n').trim() || 'Clean editorial blog illustration, minimalist modern style';

  try {
    const res = await platformAIImage(
      {
        prompt,
        size: req.size && req.size !== 'auto' ? req.size : undefined,
        quality: req.quality && req.quality !== 'auto' ? req.quality : undefined,
      },
      signal,
    );
    if (signal.aborted) throw new DOMException(aiText().stopped, 'AbortError');
    const b64 = typeof res?.dataBase64 === 'string' ? res.dataBase64 : '';
    if (!b64) throw new Error(aiText().imageIncomplete);
    const bytes = base64ToBytes(b64);
    const mediaType = res.mediaType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    return new Blob([bytes], { type: mediaType });
  } catch (failure) {
    throw formatPlatformAIError(failure, aiText().imageIncomplete);
  }
}
