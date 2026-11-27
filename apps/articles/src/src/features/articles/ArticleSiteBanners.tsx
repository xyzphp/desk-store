import { Icon, Select, useMessages } from '@xyzos/desk-ui';
import { AppImage, useBackendFileUrl } from '../../shared/sdk/media';
import { ArticleSiteQuotes } from './ArticleSiteQuotes';
import type { ArticleSiteConfig } from './api';
import type { useArticles } from './useArticles';
import { articleMessages } from './locale';

type ArticleState = ReturnType<typeof useArticles>;
const pages = [
  ['home', 'banner.jpg'],
  ['detail', 'detail-banner.jpg'],
  ['archives', 'archive-banner.jpg'],
  ['categories', 'category-banner.jpg'],
  ['tags', 'tag-banner.jpg'],
] as const;

function SiteSwitch({
  value,
  label,
  onChange,
  small = false,
  stateText,
  title,
}: {
  value: boolean;
  label: string;
  onChange: () => void;
  small?: boolean;
  stateText?: string;
  title?: string;
}) {
  const t = useMessages(articleMessages);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      title={title}
      className={`ar-switch-btn${small ? ' ar-switch-sm' : ''}${value ? ' is-active' : ''}`}
      onClick={onChange}
    >
      <span className="ar-switch-track">
        <i />
      </span>
      <span className="ar-switch-label">
        {stateText ?? `${label}: ${value ? t.common.switchOn : t.common.switchOff}`}
      </span>
    </button>
  );
}

function SiteHelpTip({ text }: { text: string }) {
  return (
    <span className="ar-help-tip" tabIndex={0} role="note" aria-label={text}>
      <Icon className="xyz-icon lucide" name="help-circle" />
      <span className="ar-help-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

export function ArticleSiteBanners({
  config,
  update,
  state,
  onPickImage,
  quoteEdits,
  setQuoteEdits,
  configDirty,
  saveConfig,
}: {
  config: ArticleSiteConfig;
  update: (change: (current: ArticleSiteConfig) => ArticleSiteConfig) => void;
  state: ArticleState;
  onPickImage: (key: string) => void;
  quoteEdits: Record<string, string>;
  setQuoteEdits: (next: Record<string, string> | ((current: Record<string, string>) => Record<string, string>)) => void;
  configDirty: boolean;
  saveConfig: () => Promise<boolean>;
}) {
  const banner = config.banners;
  const t = useMessages(articleMessages);
  const bannerImage = useBackendFileUrl(banner.home || undefined, 'theme/banner.jpg') ?? 'theme/banner.jpg';
  const avatarImage = useBackendFileUrl(config.avatarImage || undefined, 'theme/avatar.png') ?? 'theme/avatar.png';
  return (
    <>
      <section className="ar-site-settings-group ar-site-banner-control">
        <div className="ar-site-switch-row">
          <div className="ar-site-switch-info">
            <h3>
              <Icon className="xyz-icon lucide" name="image" />
              {t.site.masterTitle}
              <SiteHelpTip text={t.site.masterHelp} />
            </h3>
          </div>
          <SiteSwitch
            value={banner.enabled}
            label={t.site.masterSwitch}
            stateText={banner.enabled ? t.site.masterOn : t.site.masterOff}
            title={t.site.masterSwitchTitle}
            onChange={() =>
              update((current) => ({ ...current, banners: { ...current.banners, enabled: !current.banners.enabled } }))
            }
          />
        </div>
        <div className={`ar-hero-preview-card${banner.enabled ? '' : ' is-disabled'}`}>
          <div className="ar-hero-preview-bar">
            <span>
              <Icon className="xyz-icon lucide" name="sparkles" />
              {t.site.previewHeading}
            </span>
            <span className="ar-hero-preview-badge">
              {banner.enabled ? t.site.previewShowing : t.site.previewDisabled}
            </span>
          </div>
          <div className="ar-hero-preview-stage" style={{ backgroundImage: `url('${bannerImage}')` }}>
            <div className="ar-hero-preview-overlay">
              {banner.avatarEnabled && (
                <div className="ar-hero-preview-avatar">
                  <img src={avatarImage} alt={t.site.avatarPreviewAlt} />
                </div>
              )}
              <h4 className="ar-hero-preview-title" hidden={!config.title.trim()}>
                {config.title}
              </h4>
              <p className="ar-hero-preview-desc" hidden={config.quote.mode === 'none' || !config.description}>
                {config.description}
              </p>
            </div>
            {!banner.enabled && (
              <div className="ar-hero-preview-disabled-mask">
                <span>{t.site.masterOffMask}</span>
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="ar-site-settings-group ar-hero-profile-group">
        <header className="ar-hero-profile-header">
          <div>
            <h3>
              <Icon className="xyz-icon lucide" name="user" />
              {t.site.profileTitle}
              <SiteHelpTip text={t.site.profileHelp} />
            </h3>
          </div>
          <div className="ar-hero-avatar-switch-wrap">
            <span className="ar-hero-avatar-switch-label">{t.site.showAvatar}</span>
            <SiteSwitch
              value={banner.avatarEnabled}
              label={t.site.avatarSwitch}
              stateText={banner.avatarEnabled ? t.common.switchOn : t.common.switchOff}
              title={t.site.avatarSwitchTitle}
              small
              onChange={() =>
                update((current) => ({
                  ...current,
                  banners: { ...current.banners, avatarEnabled: !current.banners.avatarEnabled },
                }))
              }
            />
          </div>
        </header>
        <div className={`ar-hero-profile-layout${banner.avatarEnabled ? '' : ' is-avatar-hidden'}`}>
          <div className="ar-hero-avatar-side">
            <section className="ar-site-image" data-ar-site-image="avatarImage">
              <div className="ar-site-image-preview">
                {config.avatarImage ? (
                  <AppImage fileId={config.avatarImage} alt={t.site.avatarPreviewAlt} />
                ) : null}
              </div>
              <div>
                <strong>{t.site.avatarTitle}</strong>
                <div>
                  <button type="button" onClick={() => onPickImage('avatarImage')}>
                    {t.common.selectImage}
                  </button>
                  <button
                    type="button"
                    disabled={!config.avatarImage}
                    onClick={() => update((current) => ({ ...current, avatarImage: 0 }))}
                  >
                    {t.common.remove}
                  </button>
                </div>
              </div>
            </section>
            {!banner.avatarEnabled && <div className="ar-avatar-off-notice">{t.site.avatarOffNotice}</div>}
            <div className="ar-hero-title-box">
              <label className="ar-site-field">
                <span>{t.site.bannerTitleField}</span>
                <input
                  maxLength={80}
                  value={config.title}
                  onChange={(event) => {
                    const title = event.currentTarget.value;
                    update((current) => ({ ...current, title }));
                  }}
                />
              </label>
            </div>
          </div>
          <div className="ar-hero-fields-side">
            <section className="ar-site-settings-group">
              <header>
                <h3>{t.site.quoteSource}</h3>
                <SiteSwitch
                  value={config.quote.mode !== 'none'}
                  label={t.site.quoteSource}
                  stateText={config.quote.mode !== 'none' ? t.common.switchOn : t.common.switchOff}
                  small
                  onChange={() =>
                    update((current) => ({
                      ...current,
                      quote: { ...current.quote, mode: current.quote.mode === 'none' ? 'manual' : 'none' },
                    }))
                  }
                />
              </header>
              {config.quote.mode !== 'none' && (
                <div className="ar-site-quote-modes" role="group" aria-label={t.site.quoteSource}>
                  {(
                    [
                      ['manual', t.site.quoteModes.manual],
                      ['api', t.site.quoteModes.api],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={config.quote.mode === mode}
                      onClick={() => update((current) => ({ ...current, quote: { ...current.quote, mode } }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {config.quote.mode === 'manual' && (
                <label className="ar-site-field is-wide">
                  <span>{t.site.quoteField}</span>
                  <textarea
                    maxLength={240}
                    value={config.description}
                    onChange={(event) => {
                      const description = event.currentTarget.value;
                      update((current) => ({ ...current, description }));
                    }}
                  />
                </label>
              )}
              {config.quote.mode === 'api' && (
                <div className="ar-site-form">
                  <div className="ar-site-field is-wide">
                    <span>常用预设（默认已加入外联白名单；自定义域名请在「应用管理 → 外联主机」添加）</span>
                    <div className="ar-site-quote-modes" role="group" aria-label="常用一言接口预设">
                      <button
                        type="button"
                        onClick={() =>
                          update((current) => ({
                            ...current,
                            quote: {
                              ...current.quote,
                              mode: 'api',
                              url: 'https://v1.hitokoto.cn/?encode=json',
                              format: 'json',
                              field: 'hitokoto',
                            },
                          }))
                        }
                      >
                        一言（Hitokoto）
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          update((current) => ({
                            ...current,
                            quote: {
                              ...current.quote,
                              mode: 'api',
                              url: 'https://60s.viki.moe/v2/hitokoto',
                              format: 'json',
                              field: 'data.hitokoto',
                            },
                          }))
                        }
                      >
                        60s 每日一言
                      </button>
                    </div>
                  </div>
                  <label className="ar-site-field">
                    <span>{t.site.quoteApiUrl}</span>
                    <input
                      type="url"
                      maxLength={500}
                      value={config.quote.url}
                      onChange={(event) => {
                        const url = event.currentTarget.value;
                        update((current) => ({ ...current, quote: { ...current.quote, url } }));
                      }}
                    />
                  </label>
                  <div className="ar-site-field">
                    <span>{t.site.quoteApiFormat}</span>
                    <Select
                      aria-label={t.site.quoteApiFormat}
                      value={config.quote.format}
                      onChange={(event) => {
                        const format = event.currentTarget.value;
                        update((current) => ({ ...current, quote: { ...current.quote, format } }));
                      }}
                    >
                      <option value="json">JSON</option>
                      <option value="text">{t.site.quoteApiText}</option>
                    </Select>
                  </div>
                  <label className="ar-site-field">
                    <span>{t.site.quoteApiField}</span>
                    <input
                      maxLength={100}
                      value={config.quote.field}
                      onChange={(event) => {
                        const field = event.currentTarget.value;
                        update((current) => ({ ...current, quote: { ...current.quote, field } }));
                      }}
                    />
                  </label>
                  <label className="ar-site-field is-wide">
                    <span>{t.site.quoteFallback}</span>
                    <textarea
                      maxLength={240}
                      value={config.description}
                      onChange={(event) => {
                        const description = event.currentTarget.value;
                        update((current) => ({ ...current, description }));
                      }}
                    />
                  </label>
                </div>
              )}
            </section>
          </div>
        </div>
        {config.quote.mode === 'api' && (
          <ArticleSiteQuotes
            state={state}
            edits={quoteEdits}
            setEdits={setQuoteEdits}
            configDirty={configDirty}
            saveConfig={saveConfig}
          />
        )}
      </section>
      <section className="ar-site-settings-group ar-banner-grid-group">
        <header>
          <h3>
            <Icon className="xyz-icon lucide" name="image" />
            {t.site.gridTitle}
            <SiteHelpTip text={t.site.gridHelp} />
          </h3>
        </header>
        <div className="ar-site-banner-grid">
          {pages.map(([key, asset]) => {
            const label = t.site.pages[key];
            const imageId = banner[key];
            const enabledKey = `${key}Enabled` as keyof ArticleSiteConfig['banners'];
            const enabled = banner[enabledKey] as boolean;
            return (
              <section
                className={`ar-site-image ar-site-banner-card${banner.enabled && enabled ? '' : ' is-disabled'}`}
                key={key}
                data-ar-site-image={`banners.${key}`}
              >
                <div className="ar-site-image-preview is-banner">
                  <AppImage
                    fileId={imageId || undefined}
                    fallbackSrc={`theme/${asset}`}
                    alt={label}
                  />
                  <div className="ar-site-banner-card-topbar">
                    <span className="ar-site-banner-page-title">{label}</span>
                    <span
                      className={`ar-site-banner-card-badge${
                        banner.enabled && enabled ? ' is-on' : !banner.enabled ? ' is-warn' : ''
                      }`}
                    >
                      {!banner.enabled
                        ? t.site.pageStateMasterOff
                        : !enabled
                          ? t.site.pageStateOff
                          : t.site.pageStateOn}
                    </span>
                  </div>
                </div>
                <div className="ar-site-banner-card-content">
                  <div className="ar-site-banner-card-header">
                    <span className="ar-site-banner-switch-label">{t.site.pageStateLabel}</span>
                    <SiteSwitch
                      value={enabled}
                      label={label}
                      stateText={enabled ? t.common.switchOn : t.common.switchOff}
                      title={t.site.pageSwitchTitle(label)}
                      small
                      onChange={() =>
                        update((current) => ({ ...current, banners: { ...current.banners, [enabledKey]: !enabled } }))
                      }
                    />
                  </div>
                  <div className="ar-site-banner-card-actions">
                    <button type="button" onClick={() => onPickImage(`banners.${key}`)}>
                      <Icon className="xyz-icon lucide" name="image-plus" />
                      {t.site.changeImage}
                    </button>
                    <button
                      type="button"
                      className="ar-ghost-btn"
                      disabled={!imageId}
                      onClick={() => update((current) => ({ ...current, banners: { ...current.banners, [key]: 0 } }))}
                    >
                      {t.site.resetDefault}
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </>
  );
}
