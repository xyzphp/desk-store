import { useEffect } from 'react';
import type { Ref } from 'react';
import { useMessages } from '@xyzos/desk-ui';
import type { PublicArticleSiteConfig } from './publicArticleConfig';
import { articleMessages } from './locale';

export function PublicArticleHero({
  site,
  kind,
  backendBase,
  quote,
  frameWindow,
  triggerRef,
  onBarrage,
}: {
  site: PublicArticleSiteConfig;
  kind: string;
  backendBase: string;
  quote: string;
  frameWindow: Window;
  triggerRef?: Ref<HTMLButtonElement>;
  onBarrage: () => void;
}) {
  const t = useMessages(articleMessages);
  const enabled = site.banners.enabled !== false && site.banners[`${kind}Enabled`] !== false;
  const image = Number.isSafeInteger(site.banners[kind]) ? Number(site.banners[kind]) : 0;
  const showAvatar = site.banners.avatarEnabled !== false;
  const showQuote = site.quote.mode !== 'none' && (!!site.description || site.quote.mode === 'api');

  useEffect(() => {
    if (!enabled || !showAvatar || site.avatarImage) return;
    const document = frameWindow.document;
    const box = document.getElementById('box');
    const eyes = [document.getElementById('left_eye'), document.getElementById('right_eye')];
    if (!box || eyes.some((eye) => !eye)) return;
    const eyeMove = (event: MouseEvent) => {
      const rect = box.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = ((event.clientX - rect.left) * 150) / rect.width;
      const y = ((event.clientY - rect.top) * 150) / rect.height;
      eyes.forEach((eye, index) => {
        if (!eye) return;
        const left = index ? 92 : 42;
        const angle = Math.atan2(y - 65.5, x - left - 10);
        eye.style.left = `${left + 5 * Math.cos(angle)}px`;
        eye.style.top = `${53 + 5 * Math.sin(angle)}px`;
      });
    };
    document.addEventListener('mousemove', eyeMove);
    return () => document.removeEventListener('mousemove', eyeMove);
  }, [enabled, frameWindow, showAvatar, site.avatarImage]);

  if (!enabled) return null;
  return (
    <section
      id="banner"
      className={`page-header reader-hero reader-hero-${kind}`}
      data-hero={kind}
      style={image > 0 ? { backgroundImage: `url("${backendBase}/public/site/files/${image}")` } : undefined}
      aria-label={t.public.heroAria}
    >
      <div className="text-center">
        {showAvatar ? (
          <button
            id="header-img"
            ref={triggerRef}
            className="reader-avatar"
            type="button"
            aria-label={t.public.playBarrage}
            aria-haspopup="dialog"
            title={t.public.playBarrageTitle}
            onClick={onBarrage}
          >
            {site.avatarImage ? (
              <img className="reader-custom-avatar" src={`${backendBase}/public/site/files/${site.avatarImage}`} alt="" />
            ) : (
              <span id="box" aria-hidden="true">
                <span id="left_eye" />
                <span id="right_eye" />
              </span>
            )}
          </button>
        ) : null}
        {site.title ? <h1 className="lead">{site.title}</h1> : null}
        {showQuote ? <q data-reader-quote>{quote}</q> : null}
      </div>
    </section>
  );
}
