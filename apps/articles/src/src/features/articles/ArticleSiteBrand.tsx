import { Icon, useMessages } from '@xyzos/desk-ui';
import { AppImage } from '../../shared/sdk/media';
import type { ArticleSiteConfig } from './api';
import { articleMessages } from './locale';

export function ArticleSiteBrand({
  config,
  update,
  onPickImage,
}: {
  config: ArticleSiteConfig;
  update: (change: (current: ArticleSiteConfig) => ArticleSiteConfig) => void;
  onPickImage: (key: string) => void;
}) {
  const t = useMessages(articleMessages);
  return (
    <section className="ar-site-settings-group ar-brand-group">
      <header className="ar-brand-header">
        <h3>
          <Icon className="xyz-icon lucide" name="compass" />
          {t.site.brandTitle}
        </h3>
      </header>
      <div className="ar-brand-layout">
        <div className="ar-brand-form-card">
          <div className="ar-site-form is-single-col">
            <label className="ar-site-field">
              <span>{t.site.brandName}</span>
              <input
                maxLength={60}
                value={config.name}
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  update((current) => ({ ...current, name }));
                }}
              />
            </label>
            <label className="ar-site-field">
              <span>{t.site.bannerTitle}</span>
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
          <div className="ar-brand-preview-wrap">
            <div className="ar-brand-preview-title">
              <span>
                <Icon className="xyz-icon lucide" name="monitor" />
                {t.site.previewLabel}
              </span>
            </div>
            <div className="ar-brand-navbar-mock">
              <div className="ar-brand-navbar-left">
                {config.logoImage ? (
                  <AppImage
                    fileId={config.logoImage}
                    alt=""
                    className="ar-brand-nav-logo"
                  />
                ) : (
                  <span className="ar-brand-nav-logo-placeholder">
                    <Icon className="xyz-icon lucide" name="image" />
                  </span>
                )}
                <span className="ar-brand-nav-title">{config.name || '文章'}</span>
              </div>
              <div className="ar-brand-navbar-right">
                <span className="is-active">{t.site.navMock.home}</span>
                <span>{t.site.navMock.archives}</span>
                <span>{t.site.navMock.categories}</span>
                <span>{t.site.navMock.tags}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="ar-brand-logo-card">
          <section className="ar-site-image" data-ar-site-image="logoImage">
            <div className="ar-site-image-preview">
              {config.logoImage ? (
                <AppImage fileId={config.logoImage} alt={t.site.logoAlt} />
              ) : (
                <Icon className="xyz-icon lucide" name="image" />
              )}
            </div>
            <div>
              <strong>{t.site.logoTitle}</strong>
              <div>
                <button type="button" onClick={() => onPickImage('logoImage')}>
                  <Icon className="xyz-icon lucide" name="image-plus" />
                  {t.common.selectImage}
                </button>
                <button
                  type="button"
                  disabled={!config.logoImage}
                  onClick={() => update((current) => ({ ...current, logoImage: 0 }))}
                >
                  {t.common.remove}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
