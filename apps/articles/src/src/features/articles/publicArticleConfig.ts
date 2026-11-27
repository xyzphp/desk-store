import { articleText } from './locale';

export interface PublicArticleSiteConfig {
  name: string;
  title: string;
  description: string;
  logoImage: number;
  avatarImage: number;
  banners: Record<string, unknown>;
  footer: Record<string, unknown>;
  quote: { mode: string };
}

export const defaultPublicArticleSite = (): PublicArticleSiteConfig => ({
  name: '文章',
  title: '文章',
  description: articleText().public.defaultDescription,
  logoImage: 0,
  avatarImage: 0,
  banners: {},
  footer: {},
  quote: { mode: 'manual' },
});

export const isPublicRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const cleanPublicText = (value: unknown, fallback = '') =>
  typeof value === 'string' && value.length <= 4000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    ? value
    : fallback;

export const safePublicImageID = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;

export function readPublicArticleSite(value: unknown): PublicArticleSiteConfig {
  if (!isPublicRecord(value) || value.ok !== true || !isPublicRecord(value.site) || !isPublicRecord(value.site.config))
    throw new Error(articleText().public.configFormatError);
  const config = value.site.config;
  return {
    ...defaultPublicArticleSite(),
    name: cleanPublicText(config.name, defaultPublicArticleSite().name),
    title: cleanPublicText(config.title),
    description: cleanPublicText(config.description),
    logoImage: safePublicImageID(config.logoImage) ? Number(config.logoImage) : 0,
    avatarImage: safePublicImageID(config.avatarImage) ? Number(config.avatarImage) : 0,
    banners: isPublicRecord(config.banners) ? config.banners : {},
    footer: isPublicRecord(config.footer) ? config.footer : {},
    quote: isPublicRecord(config.quote)
      ? { mode: cleanPublicText(config.quote.mode, 'manual') }
      : defaultPublicArticleSite().quote,
  };
}
