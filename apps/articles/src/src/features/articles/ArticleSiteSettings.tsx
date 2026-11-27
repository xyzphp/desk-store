import { useEffect, useRef, useState } from 'react';
import { Icon, WindowTitlebar, useMessages } from '@xyzos/desk-ui';
import { useHost } from '../../host/HostProvider';
import { AppImage } from '../../shared/sdk/media';
import { articleFileId, type ArticleSiteConfig } from './api';
import { ArticleSiteBanners } from './ArticleSiteBanners';
import { ArticleSiteBrand } from './ArticleSiteBrand';
import { ArticleSiteFooter } from './ArticleSiteFooter';
import { ArticleSiteTaxonomies } from './ArticleSiteTaxonomies';
import type { useArticles } from './useArticles';
import { useArticleSite } from './useArticleSite';
import { articleMessages } from './locale';

type ArticleState = ReturnType<typeof useArticles>;
type Tab = 'brand' | 'banners' | 'footer' | 'categories' | 'tags';
const tabs: readonly Tab[] = ['brand', 'banners', 'footer', 'categories', 'tags'];

function updateImage(config: ArticleSiteConfig, key: string, id: number): ArticleSiteConfig {
  const [root, branch, index, property] = key.split('.');
  if (root === 'logoImage' || root === 'avatarImage') return { ...config, [root]: id };
  if (root === 'banners' && branch) return { ...config, banners: { ...config.banners, [branch]: id } };
  if (root === 'footer' && branch === 'bgImage') return { ...config, footer: { ...config.footer, bgImage: id } };
  if (root === 'footer' && branch === 'columns' && index && property === 'image') {
    const column = Number(index);
    return {
      ...config,
      footer: {
        ...config.footer,
        columns: config.footer.columns.map((item, current) => (current === column ? { ...item, image: id } : item)),
      },
    };
  }
  return config;
}

export function ArticleSiteSettings({ state }: { state: ArticleState }) {
  const host = useHost();
  const t = useMessages(articleMessages);
  const site = useArticleSite(state);
  const [imageKey, setImageKey] = useState('');
  const [imageQuery, setImageQuery] = useState('');
  const imageDialog = useRef<HTMLDialogElement>(null);
  const activeTab = state.siteTab;

  const openPicker = async (key: string) => {
    try {
      await site.loadImages();
      setImageQuery('');
      setImageKey(key);
    } catch (failure) {
      state.setError(failure instanceof Error ? failure.message : t.site.imagesLoadFailed);
    }
  };
  const chooseImage = (id: number) => {
    site.update((current) => updateImage(current, imageKey, id));
    setImageKey('');
  };
  const imageFiles = site.imageFiles.filter((file) =>
    file.name.toLocaleLowerCase().includes(imageQuery.toLocaleLowerCase()),
  );
  useEffect(() => {
    const dialog = imageDialog.current;
    if (!imageKey || !dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [imageKey]);
  const content = site.loading ? (
    <p className="ar-site-loading" role="status">
      {t.site.loading}
    </p>
  ) : !site.config ? (
    <div className="ar-empty-editor">
      <h2>{t.site.loadFailed}</h2>
      <button type="button" data-ar-site-reload onClick={() => void site.load()}>
        {t.site.reload}
      </button>
    </div>
  ) : activeTab === 'brand' ? (
    <ArticleSiteBrand config={site.config} update={site.update} onPickImage={(key) => void openPicker(key)} />
  ) : activeTab === 'banners' ? (
    <ArticleSiteBanners
      config={site.config}
      update={site.update}
      state={state}
      onPickImage={(key) => void openPicker(key)}
      quoteEdits={site.quoteEdits}
      setQuoteEdits={site.setQuoteEdits}
      configDirty={site.configDirty}
      saveConfig={site.save}
    />
  ) : activeTab === 'footer' ? (
    <ArticleSiteFooter config={site.config} update={site.update} onPickImage={(key) => void openPicker(key)} />
  ) : (
    <ArticleSiteTaxonomies state={state} kind={activeTab === 'categories' ? 'category' : 'tag'} />
  );

  return (
    <section className="ar-site">
      <header className="ar-site-header">
        <div>
          <h2>{t.site.title}</h2>
          <nav aria-label={t.site.modulesAria}>
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                data-ar-site-tab={tab}
                aria-pressed={activeTab === tab}
                onClick={() => state.setSiteTab(tab)}
              >
                {t.site.tabs[tab]}
              </button>
            ))}
          </nav>
        </div>
        <button
          type="button"
          className="ar-button"
          data-ar-site-view
          title={t.site.viewSiteTitle}
          onClick={() => {
            void host.openPublicSite('').catch((failure: unknown) => {
              state.setError(failure instanceof Error ? failure.message : t.sidebar.openAppFailed);
            });
          }}
        >
          <Icon className="xyz-icon lucide" name="globe" />
          {t.site.viewSite}
        </button>
      </header>
      <div className="ar-site-body">{content}</div>
      <footer className="ar-site-actions">
        <div>
          <span data-ar-site-state>{site.dirty ? t.site.dirty : site.site?.updatedAt ? t.site.synced : ''}</span>
          <span data-ar-site-status role="status" aria-live="polite">
            {state.error || state.status}
          </span>
        </div>
        <div>
          <button
            type="button"
            data-ar-site-reload
            disabled={site.busy || site.loading}
            onClick={async () => {
              if (
                site.dirty &&
                !(await state.dialogs.confirm({
                  title: t.site.reloadTitle,
                  message: t.site.reloadMessage,
                  danger: true,
                }))
              )
                return;
              await site.load();
            }}
          >
            <Icon className="xyz-icon lucide" name="rotate-ccw" />
            {t.site.reload}
          </button>
          {activeTab !== 'categories' && activeTab !== 'tags' && (
            <button
              type="button"
              className="ar-primary"
              data-ar-site-save
              disabled={site.busy || site.loading || !site.configDirty}
              onClick={() => void site.save()}
            >
              <Icon className="xyz-icon lucide" name="save" />
              {t.site.saveApply}
            </button>
          )}
        </div>
      </footer>
      {imageKey && (
        <dialog
          ref={imageDialog}
          className="ar-modal"
          aria-label={t.site.imageDialogAria}
          onCancel={(event) => {
            event.preventDefault();
            setImageKey('');
          }}
        >
          <WindowTitlebar
            as="header"
            className="window-dialog-head"
            title={t.site.imageDialogTitle}
            controls={['close']}
            onClose={() => setImageKey('')}
          />
          <div className="ar-modal-body">
            <div className="ar-file-tools">
              <button
                type="button"
                className="ar-button"
                onClick={async () => {
                  const picked = await state.pickFromFileManager({ attachToDraft: false, imagesOnly: true });
                  if (!picked) return;
                  const id = articleFileId(picked.file);
                  if (!id) return;
                  await site.loadImages();
                  chooseImage(id);
                }}
              >
                <Icon className="xyz-icon lucide" name="folder-open" />
                从文件管理选择
              </button>
              <label className="ar-button">
                <Icon className="xyz-icon lucide" name="upload" />
                {t.site.uploadImage}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  hidden
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (!file) return;
                    try {
                      const id = await site.uploadImage(file);
                      chooseImage(id);
                    } catch (failure) {
                      state.setError(failure instanceof Error ? failure.message : t.site.imageUploadFailed);
                    }
                  }}
                />
              </label>
              <input
                type="search"
                className="ar-modal-search"
                placeholder={t.site.imageSearchPlaceholder}
                aria-label={t.site.imageSearchAria}
                value={imageQuery}
                onChange={(event) => setImageQuery(event.currentTarget.value)}
              />
            </div>
            <div className="ar-site-image-picker">
              {imageFiles.length ? (
                imageFiles.map((file) => {
                  const id = articleFileId(file);
                  return id ? (
                    <button key={file.id} type="button" data-ar-site-image-choice={id} onClick={() => chooseImage(id)}>
                      <AppImage fileId={id} alt="" />
                      <span>{file.name}</span>
                    </button>
                  ) : null;
                })
              ) : (
                <p>{t.site.noImages}</p>
              )}
            </div>
          </div>
        </dialog>
      )}
    </section>
  );
}
