import type { CSSProperties } from 'react';
import { Select, Icon, useMessages } from '@xyzos/desk-ui';
import { AppImage, useBackendFileUrl } from '../../shared/sdk/media';
import type { ArticleSiteConfig } from './api';
import { articleFooterBackgroundFallback, articleFooterTextFallback } from './siteStyleDefaults';
import { articleMessages, type ArticleMessages } from './locale';
import { groupArticleFooterItems } from './footerItems';
import { ArticleFooterItemsEditor } from './ArticleFooterItemsEditor';

const linkColors = ['#458fd2', '#e9573f', '#8cc152', '#967adc', '#f6bb42'];

function footerModeLabel(mode: ArticleSiteConfig['footer']['bgMode'], t: ArticleMessages) {
  return t.site.footerModeLabels[mode];
}

function footerBackground(config: ArticleSiteConfig, resolvedBgUrl?: string) {
  const mode = config.footer.bgMode;
  if (mode === 'none') return { image: 'none', repeat: 'no-repeat', size: 'auto', position: 'center' };
  const url = config.footer.bgImage
    ? resolvedBgUrl || 'theme/footer_bg_01.png'
    : 'theme/footer_bg_01.png';
  if (mode === 'cover')
    return { image: `url("${url}")`, repeat: 'no-repeat', size: 'cover', position: 'center center' };
  if (mode === 'contain')
    return { image: `url("${url}")`, repeat: 'no-repeat', size: 'contain', position: 'center center' };
  if (mode === 'center')
    return { image: `url("${url}")`, repeat: 'no-repeat', size: 'auto', position: 'center center' };
  return { image: `url("${url}")`, repeat: 'repeat', size: 'auto', position: '0 0' };
}

function FooterPreview({ config }: { config: ArticleSiteConfig }) {
  const t = useMessages(articleMessages);
  const footer = config.footer;
  const resolvedBgUrl = useBackendFileUrl(footer.bgImage || undefined, 'theme/footer_bg_01.png');
  const opacity = Math.max(0, Math.min(1, Number.parseFloat(footer.bgOverlay) || 0));
  const columns = footer.columns.filter((column) => column.enabled !== false);
  const footerRows = groupArticleFooterItems(footer.items);
  const background = footerBackground(config, resolvedBgUrl);
  const previewStyle = {
    backgroundColor: footer.bgColor || articleFooterBackgroundFallback,
    backgroundImage: background.image,
    backgroundRepeat: background.repeat,
    backgroundSize: background.size,
    backgroundPosition: background.position,
    color: footer.textColor || articleFooterTextFallback,
  } as const;

  return (
    <div className={`ar-footer-preview-card${footer.enabled ? '' : ' is-disabled'}`}>
      <div className="ar-footer-preview-topbar">
        <div className="ar-footer-preview-meta">
          <span>
            <Icon className="xyz-icon lucide" name="sparkles" />
            {t.site.footerPreview}
          </span>
        </div>
        <div className="ar-footer-preview-badges">
          <span className="ar-footer-badge-mode">{footerModeLabel(footer.bgMode, t)}</span>
          {opacity > 0 && footer.bgMode !== 'none' && (
            <span className="ar-footer-badge-overlay">{t.site.overlayBadge(Math.round(opacity * 100))}</span>
          )}
        </div>
      </div>
      <div
        className="ar-footer-bg-preview-stage"
        data-align={footer.align}
        data-border={footer.borderStyle}
        aria-label={t.site.footerPreviewAria}
        style={previewStyle}
      >
        <div
          className="ar-footer-preview-overlay-mask"
          style={{
            backgroundColor: opacity > 0 && footer.bgMode !== 'none' ? `rgba(0, 0, 0, ${opacity})` : 'transparent',
          }}
        />
        <div className="ar-footer-preview-container">
          <div
            className="ar-footer-preview-grid"
            style={{ '--footer-cols': Math.max(1, columns.length) } as CSSProperties}
          >
            {columns.length ? (
              columns.map((column, index) => (
                <div className="ar-footer-preview-column" key={`preview-column-${index}`}>
                  <h5>{column.title || t.site.unnamedColumn}</h5>
                  {column.type === 'image' ? (
                    column.image ? (
                      <AppImage
                        fileId={column.image}
                        alt=""
                        className="ar-footer-preview-col-img"
                      />
                    ) : (
                      <div className="ar-footer-preview-col-noimg">
                        <Icon className="xyz-icon lucide" name="image" />
                        <span>{t.site.noColumnImage}</span>
                      </div>
                    )
                  ) : column.type === 'text' ? (
                    <p className="ar-footer-preview-col-text">{column.text || t.site.noColumnText}</p>
                  ) : column.type === 'keyvalue' ? (
                    (column.items ?? []).some((item) => item.key.trim()) ? (
                      <div className="ar-footer-preview-kv-list">
                        {(column.items ?? [])
                          .filter((item) => item.key.trim())
                          .map((item, itemIndex) => (
                            <div className="ar-footer-preview-kv-row" key={`preview-kv-${index}-${itemIndex}`}>
                              <span className="ar-footer-preview-kv-key">{item.key}</span>
                              <span className="ar-footer-preview-kv-val">{item.value}</span>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <span className="ar-footer-preview-empty-links">{t.site.noColumnFields}</span>
                    )
                  ) : (column.links ?? []).length ? (
                    <div className="ar-footer-preview-pills">
                      {(column.links ?? []).map((link, linkIndex) => (
                        <span
                          className="ar-footer-preview-pill"
                          key={`preview-link-${index}-${linkIndex}`}
                          style={{ backgroundColor: linkColors[linkIndex % linkColors.length] }}
                        >
                          {link.label || t.site.linkFallback}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="ar-footer-preview-empty-links">{t.site.noColumnLinks}</span>
                  )}
                </div>
              ))
            ) : (
              <div className="ar-footer-preview-empty-cols">
                <Icon className="xyz-icon lucide" name="columns" />
                <span>{t.site.allColumnsOff}</span>
              </div>
            )}
          </div>
          {footerRows.length > 0 && (
            <div className="ar-footer-preview-items">
              {footerRows.map((row, rowIndex) => (
                <div className="ar-footer-preview-item-row" key={`preview-footer-row-${rowIndex}`}>
                  {row.map((item, itemIndex) => (
                    <span className="ar-footer-preview-item-wrap" key={`preview-footer-item-${rowIndex}-${itemIndex}`}>
                      {itemIndex > 0 && <span aria-hidden="true">|</span>}
                      <span className={item.url ? 'is-link' : ''}>{item.text}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
          {footerRows.length === 0 && (
            <div className="ar-footer-preview-bottom">
              <span className="ar-footer-preview-bottom-copy">{footer.copyright || '© 文章'}</span>
              {footer.recordLabel && <span className="ar-footer-preview-bottom-record">{footer.recordLabel}</span>}
            </div>
          )}
        </div>
        {!footer.enabled && (
          <div className="ar-hero-preview-disabled-mask">
            <span>{t.site.footerOffMask}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ value, onClick, label }: { value: boolean; onClick: () => void; label: string }) {
  const t = useMessages(articleMessages);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={`ar-switch-btn${value ? ' is-active' : ''}`}
      onClick={onClick}
    >
      <span className="ar-switch-track">
        <i />
      </span>
      <span className="ar-switch-label">
        {label}: {value ? t.common.switchOn : t.common.switchOff}
      </span>
    </button>
  );
}

export function ArticleSiteFooter({
  config,
  update,
  onPickImage,
}: {
  config: ArticleSiteConfig;
  update: (change: (current: ArticleSiteConfig) => ArticleSiteConfig) => void;
  onPickImage: (key: string) => void;
}) {
  const t = useMessages(articleMessages);
  const footer = config.footer;
  const footerRows = groupArticleFooterItems(footer.items);
  const patch = (value: Partial<ArticleSiteConfig['footer']>) =>
    update((current) => ({ ...current, footer: { ...current.footer, ...value } }));
  return (
    <>
      <section className="ar-site-settings-group ar-footer-control-group">
        <header className="ar-site-switch-row">
          <div className="ar-site-switch-info">
            <h3>
              <Icon className="xyz-icon lucide" name="panel-bottom-open" />
              {t.site.footerDisplay}
            </h3>
            <p>{t.site.footerDisplayDesc}</p>
          </div>
          <Toggle
            value={footer.enabled}
            label={t.site.footerMaster}
            onClick={() => patch({ enabled: !footer.enabled })}
          />
        </header>
        <FooterPreview config={config} />
      </section>
      <section className="ar-site-settings-group ar-footer-appearance-group">
        <header>
          <h3>
            <Icon className="xyz-icon lucide" name="palette" />
            {t.site.footerStyle}
          </h3>
        </header>
        <div className="ar-site-form">
          <label className="ar-site-field">
            <span>{t.site.bgColor}</span>
            <input
              value={footer.bgColor}
              maxLength={40}
              onChange={(event) => {
                const value = event.currentTarget.value;
                patch({ bgColor: value });
              }}
            />
          </label>
          <label className="ar-site-field">
            <span>{t.site.textColor}</span>
            <input
              value={footer.textColor}
              maxLength={40}
              onChange={(event) => {
                const value = event.currentTarget.value;
                patch({ textColor: value });
              }}
            />
          </label>
          <label className="ar-site-field">
            <span>{t.site.bgMode}</span>
            <Select
              value={footer.bgMode}
              onChange={(event) => {
                const value = event.currentTarget.value as ArticleSiteConfig['footer']['bgMode'];
                patch({ bgMode: value });
              }}
            >
              <option value="repeat">{t.site.bgModes.repeat}</option>
              <option value="cover">{t.site.bgModes.cover}</option>
              <option value="contain">{t.site.bgModes.contain}</option>
              <option value="center">{t.site.bgModes.center}</option>
              <option value="none">{t.site.bgModes.none}</option>
            </Select>
          </label>
          <label className="ar-site-field">
            <span>{t.site.bgOverlay}</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={footer.bgOverlay}
              onChange={(event) => {
                const value = event.currentTarget.value;
                patch({ bgOverlay: value });
              }}
            />
          </label>
          <label className="ar-site-field">
            <span>{t.site.borderStyle}</span>
            <Select
              value={footer.borderStyle}
              onChange={(event) => {
                const value = event.currentTarget.value as ArticleSiteConfig['footer']['borderStyle'];
                patch({ borderStyle: value });
              }}
            >
              <option value="solid">{t.site.borderStyles.solid}</option>
              <option value="gradient">{t.site.borderStyles.gradient}</option>
              <option value="dashed">{t.site.borderStyles.dashed}</option>
              <option value="none">{t.site.borderStyles.none}</option>
            </Select>
          </label>
          <label className="ar-site-field">
            <span>{t.site.align}</span>
            <Select
              value={footer.align}
              onChange={(event) => {
                const value = event.currentTarget.value as ArticleSiteConfig['footer']['align'];
                patch({ align: value });
              }}
            >
              <option value="center">{t.site.aligns.center}</option>
              <option value="split">{t.site.aligns.split}</option>
            </Select>
          </label>
          <button type="button" className="ar-button" onClick={() => onPickImage('footer.bgImage')}>
            <Icon className="xyz-icon lucide" name="image-plus" />
            {t.site.chooseFooterImage}
          </button>
          <label className="ar-switch">
            <input
              type="checkbox"
              checked={footer.showPoweredBy}
              onChange={() => patch({ showPoweredBy: !footer.showPoweredBy })}
            />
            <span className="ar-switch-track">
              <i />
            </span>
            <span className="ar-switch-text">{t.site.showPoweredBy}</span>
          </label>
        </div>
      </section>
      <section className="ar-site-settings-group ar-footer-columns-group">
        <header>
          <h3>
            <Icon className="xyz-icon lucide" name="columns" />
            {t.site.columnsTitle}
          </h3>
          <button
            type="button"
            className="ar-button"
            disabled={footer.columns.length >= 8}
            onClick={() =>
              patch({ columns: [...footer.columns, { enabled: true, type: 'text', title: '', text: '' }] })
            }
          >
            <Icon className="xyz-icon lucide" name="plus" />
            {t.site.addColumn}
          </button>
        </header>
        {footer.columns.map((column, index) => (
          <article className="ar-site-col-card ar-footer-column-editor" key={`footer-column-${index}`}>
            <header className="ar-site-col-header">
              <strong className="ar-site-col-badge">{t.site.columnBadge(index + 1)}</strong>
              <input
                className="ar-site-col-title-input"
                maxLength={60}
                placeholder={t.site.columnTitlePlaceholder}
                aria-label={t.site.columnTitleAria(index + 1)}
                value={column.title}
                onChange={(event) => {
                  const title = event.currentTarget.value;
                  patch({
                    columns: footer.columns.map((item, itemIndex) => (itemIndex === index ? { ...item, title } : item)),
                  });
                }}
              />
              <Select
                className="ar-site-col-type-select"
                aria-label={t.site.columnTypeAria(index + 1)}
                value={column.type}
                onChange={(event) => {
                  const type = event.currentTarget.value as typeof column.type;
                  patch({
                    columns: footer.columns.map((item, itemIndex) => (itemIndex === index ? { ...item, type } : item)),
                  });
                }}
              >
                <option value="image">{t.site.typeOptions.image}</option>
                <option value="links">{t.site.typeOptions.links}</option>
                <option value="keyvalue">{t.site.typeOptions.keyvalue}</option>
                <option value="text">{t.site.typeOptions.text}</option>
              </Select>
              <button
                type="button"
                role="switch"
                aria-checked={column.enabled}
                aria-label={t.site.enableColumnAria(index + 1)}
                className={`ar-switch-btn ar-switch-sm${column.enabled ? ' is-active' : ''}`}
                onClick={() =>
                  patch({
                    columns: footer.columns.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, enabled: !item.enabled } : item,
                    ),
                  })
                }
              >
                <span className="ar-switch-track">
                  <i />
                </span>
                <span className="ar-switch-label">{column.enabled ? t.common.switchOn : t.common.switchOff}</span>
              </button>
              <div className="ar-site-col-tools">
                <button
                  type="button"
                  title={t.site.moveUp}
                  aria-label={t.site.moveUpAria}
                  disabled={index === 0}
                  onClick={() => {
                    const next = [...footer.columns];
                    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                    patch({ columns: next });
                  }}
                >
                  <Icon className="xyz-icon lucide" name="arrow-up" />
                </button>
                <button
                  type="button"
                  title={t.site.moveDown}
                  aria-label={t.site.moveDownAria}
                  disabled={index === footer.columns.length - 1}
                  onClick={() => {
                    const next = [...footer.columns];
                    [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                    patch({ columns: next });
                  }}
                >
                  <Icon className="xyz-icon lucide" name="arrow-down" />
                </button>
                <button
                  type="button"
                  className="ar-danger"
                  aria-label={t.site.deleteColumnAria(index + 1)}
                  onClick={() => patch({ columns: footer.columns.filter((_, item) => item !== index) })}
                >
                  <Icon className="xyz-icon lucide" name="trash-2" />
                </button>
              </div>
            </header>
            <div className="ar-site-form ar-site-col-body">
              <label className="ar-site-field">
                <span>{t.site.typeField}</span>
                <Select
                  value={column.type}
                  onChange={(event) => {
                    const type = event.currentTarget.value as typeof column.type;
                    patch({
                      columns: footer.columns.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, type } : item,
                      ),
                    });
                  }}
                >
                  <option value="links">{t.site.typeOptionsSimple.links}</option>
                  <option value="text">{t.site.typeOptionsSimple.text}</option>
                  <option value="image">{t.site.typeOptionsSimple.image}</option>
                  <option value="keyvalue">{t.site.typeOptionsSimple.keyvalue}</option>
                </Select>
              </label>
              <label className="ar-site-field">
                <span>{t.site.titleField}</span>
                <input
                  maxLength={60}
                  value={column.title}
                  onChange={(event) => {
                    const title = event.currentTarget.value;
                    patch({
                      columns: footer.columns.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, title } : item,
                      ),
                    });
                  }}
                />
              </label>
              {column.type === 'text' && (
                <label className="ar-site-field is-wide">
                  <span>{t.site.contentField}</span>
                  <textarea
                    maxLength={500}
                    value={column.text ?? ''}
                    onChange={(event) => {
                      const text = event.currentTarget.value;
                      patch({
                        columns: footer.columns.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, text } : item,
                        ),
                      });
                    }}
                  />
                </label>
              )}
              {column.type === 'image' && (
                <div className="ar-site-col-image-content">
                  <div className="ar-site-image-preview is-col-thumb">
                    {column.image ? (
                      <AppImage fileId={column.image} alt={column.title} />
                    ) : (
                      <Icon className="xyz-icon lucide" name="image" />
                    )}
                  </div>
                  <div className="ar-site-col-image-actions">
                    <button
                      type="button"
                      className="ar-button"
                      onClick={() => onPickImage(`footer.columns.${index}.image`)}
                    >
                      <Icon className="xyz-icon lucide" name="image-plus" />
                      {t.common.selectImage}
                    </button>
                    <button
                      type="button"
                      className="ar-button"
                      disabled={!column.image}
                      onClick={() =>
                        patch({
                          columns: footer.columns.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, image: 0 } : item,
                          ),
                        })
                      }
                    >
                      <Icon className="xyz-icon lucide" name="x" />
                      {t.site.removeImage}
                    </button>
                  </div>
                </div>
              )}
            </div>
            {column.type === 'links' && (
              <div className="ar-site-col-links-content ar-site-links">
                <header>
                  <h3>{t.site.linksTitle}</h3>
                  <button
                    type="button"
                    className="ar-button"
                    disabled={(column.links?.length ?? 0) >= 16}
                    onClick={() =>
                      patch({
                        columns: footer.columns.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, links: [...(item.links ?? []), { label: '', url: '' }] }
                            : item,
                        ),
                      })
                    }
                  >
                    <Icon className="xyz-icon lucide" name="plus" />
                    {t.site.addLink}
                  </button>
                </header>
                <div className="ar-site-col-links-list">
                  {(column.links ?? []).map((link, linkIndex) => (
                    <div className="ar-site-link-row" key={`link-${index}-${linkIndex}`}>
                      <input
                        maxLength={100}
                        aria-label={t.site.linkNameAria(linkIndex + 1)}
                        value={link.label}
                        placeholder={t.site.linkNamePlaceholder}
                        onChange={(event) => {
                          const label = event.currentTarget.value;
                          patch({
                            columns: footer.columns.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    links: item.links?.map((entry, entryIndex) =>
                                      entryIndex === linkIndex ? { ...entry, label } : entry,
                                    ),
                                  }
                                : item,
                            ),
                          });
                        }}
                      />
                      <input
                        type="url"
                        maxLength={500}
                        aria-label={t.site.linkUrlAria(linkIndex + 1)}
                        value={link.url}
                        placeholder="https://"
                        onChange={(event) => {
                          const url = event.currentTarget.value;
                          patch({
                            columns: footer.columns.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    links: item.links?.map((entry, entryIndex) =>
                                      entryIndex === linkIndex ? { ...entry, url } : entry,
                                    ),
                                  }
                                : item,
                            ),
                          });
                        }}
                      />
                      <button
                        type="button"
                        aria-label={t.site.removeLink}
                        onClick={() =>
                          patch({
                            columns: footer.columns.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, links: item.links?.filter((_, entryIndex) => entryIndex !== linkIndex) }
                                : item,
                            ),
                          })
                        }
                      >
                        <Icon className="xyz-icon lucide" name="x" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {column.type === 'keyvalue' && (
              <div className="ar-site-col-kv-content">
                <div className="ar-site-col-kv-list">
                  {(column.items ?? []).map((item, itemIndex) => (
                    <div className="ar-site-kv-row" key={`kv-${index}-${itemIndex}`}>
                      <input
                        maxLength={60}
                        aria-label={t.site.kvNameAria(index + 1, itemIndex + 1)}
                        placeholder={t.site.kvNamePlaceholder}
                        value={item.key}
                        onChange={(event) => {
                          const key = event.currentTarget.value;
                          patch({
                            columns: footer.columns.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    items: entry.items?.map((current, currentIndex) =>
                                      currentIndex === itemIndex ? { ...current, key } : current,
                                    ),
                                  }
                                : entry,
                            ),
                          });
                        }}
                      />
                      <input
                        maxLength={200}
                        aria-label={t.site.kvValueAria(index + 1, itemIndex + 1)}
                        placeholder={t.site.kvValuePlaceholder}
                        value={item.value}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          patch({
                            columns: footer.columns.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    items: entry.items?.map((current, currentIndex) =>
                                      currentIndex === itemIndex ? { ...current, value } : current,
                                    ),
                                  }
                                : entry,
                            ),
                          });
                        }}
                      />
                      <button
                        type="button"
                        aria-label={t.site.deleteField}
                        onClick={() =>
                          patch({
                            columns: footer.columns.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    items: entry.items?.filter((_, currentIndex) => currentIndex !== itemIndex),
                                  }
                                : entry,
                            ),
                          })
                        }
                      >
                        <Icon className="xyz-icon lucide" name="x" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="ar-site-col-add-link-btn"
                  disabled={(column.items?.length ?? 0) >= 16}
                  onClick={() =>
                    patch({
                      columns: footer.columns.map((entry, entryIndex) =>
                        entryIndex === index
                          ? {
                              ...entry,
                              items: [...(entry.items ?? []), { key: '', value: '' }],
                            }
                          : entry,
                      ),
                    })
                  }
                >
                  <Icon className="xyz-icon lucide" name="plus" />
                  {t.site.addField(column.items?.length ?? 0)}
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
      <ArticleFooterItemsEditor items={footer.items} onChange={(items) => patch({ items })} />
      {footerRows.length === 0 && (
        <section className="ar-site-settings-group is-legal">
          <header>
            <h3>
              <Icon className="xyz-icon lucide" name="check" />
              {t.site.legalTitle}
            </h3>
          </header>
          <div className="ar-site-form">
            <label className="ar-site-field is-wide">
              <span>{t.site.copyright}</span>
              <textarea
                maxLength={240}
                value={footer.copyright}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  patch({ copyright: value });
                }}
              />
            </label>
            <label className="ar-site-field">
              <span>{t.site.recordText}</span>
              <input
                maxLength={100}
                value={footer.recordLabel}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  patch({ recordLabel: value });
                }}
              />
            </label>
            <label className="ar-site-field">
              <span>{t.site.recordLink}</span>
              <input
                type="url"
                maxLength={500}
                value={footer.recordUrl}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  patch({ recordUrl: value });
                }}
              />
            </label>
          </div>
        </section>
      )}
    </>
  );
}
