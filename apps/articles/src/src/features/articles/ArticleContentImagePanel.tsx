import { useId, useRef, useState, type RefObject } from 'react';
import { Select, AnchorPopover, Button, Checkbox, HelpTip, Icon, WindowTitlebar, useMessages } from '@xyzos/desk-ui';
import type { ArticleContentImageAIState } from './useArticleContentImageAI';
import { articleImageQualityKeys, articleImageSizeKeys, validArticleImageSize } from './articleImageAI';
import { AIModelPicker } from '../../shared/ai/AIModelPicker';
import { rangeFill } from '../../shared/ai/rangeFill';
import { AIPanelResizers, useAIPanelGesture } from '../../shared/ai/useAIPanelGesture';
import { articleMessages } from './locale';

export function ArticleContentImagePanel({
  ai,
  anchor,
  dialogId,
  fields,
}: {
  ai: ArticleContentImageAIState;
  anchor: RefObject<HTMLButtonElement | null>;
  dialogId: string;
  fields: Readonly<Record<string, string>>;
}) {
  const t = useMessages(articleMessages);
  const gesture = useAIPanelGesture();
  const sizeAnchor = useRef<HTMLButtonElement>(null);
  const sizeId = useId();
  const [sizeOpen, setSizeOpen] = useState(false);
  const selection = ai.selection;
  const context = selection?.source.slice(selection.start, selection.end) ?? '';
  const referenceIds = (ai.capability?.contextFields ?? []).filter(
    (id) => id !== 'content' && Boolean(fields[id]?.trim()),
  );
  const hasReferences = ai.references.some((id) => Boolean(fields[id]?.trim()));
  const canGenerate = Boolean((context.trim() || hasReferences || ai.instruction.trim()) && ai.modelId);
  const qualityIndex = Math.max(
    0,
    articleImageQualityKeys.findIndex((value) => value === ai.quality),
  );
  const sizeKey = articleImageSizeKeys.find((value) => value === ai.size);
  const sizeLabel = sizeKey ? t.imageAI.sizes[sizeKey].label : t.imageAI.sizes.custom.label;
  const applyLabel =
    ai.use === 'library'
      ? ai.result?.saved
        ? t.contentImage.savedToLibrary
        : t.contentImage.saveToLibrary
      : ai.use === 'replace'
        ? t.contentImage.uploadReplace
        : t.contentImage.uploadInsert;

  return (
    <>
      <AnchorPopover
        as="section"
        id={dialogId}
        open={ai.open}
        anchor={anchor}
        role="dialog"
        aria-label={t.contentImage.panelTitle}
        aria-busy={ai.phase === 'generating' || ai.phase === 'applying'}
        className="desk-form-ai-layer desk-article-ai-layer ai-assist-popover workspace-app workspace-scrollbars"
        {...gesture.panelProps}
        placement="bottom-start"
        gap={8}
        dismissOnFocusOutside={false}
        onClose={ai.close}
      >
        <WindowTitlebar
          as="header"
          className="win-titlebar ai-assist-head"
          title={t.contentImage.panelTitle}
          {...gesture.handleProps}
          controls={['close']}
          onClose={ai.close}
        />
        <div className="ai-assist-body">
          <div className={`ai-assist-comparison${context.trim() ? ' is-comparing' : ''}`} data-ai-comparison>
            <section
              className="ai-assist-compare-pane"
              data-ai-source
              aria-label={t.contentImage.sourcePane}
              hidden={!context.trim()}
            >
              <header className="workspace-field-heading">
                <strong>{t.contentImage.sourceHeading}</strong>
              </header>
              <pre className="workspace-field" data-ai-original tabIndex={0} aria-label={t.contentImage.sourceAria}>
                {context}
              </pre>
            </section>
            <section
              className="ai-assist-compare-pane ai-assist-preview"
              data-ai-preview
              aria-label={t.contentImage.previewHeading}
            >
              <header className="workspace-field-heading">
                <strong>{t.contentImage.previewHeading}</strong>
              </header>
              {ai.phase === 'loading' || ai.phase === 'generating' ? (
                <div className="workspace-field ai-assist-pending" role="status">
                  <div className="ai-assist-progress" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span>{ai.phase === 'loading' ? t.contentImage.loadingConfig : t.common.generatingImage}</span>
                </div>
              ) : ai.result ? (
                <div className="ai-assist-image-preview">
                  <img src={ai.result.url} alt={t.contentImage.previewAlt} />
                </div>
              ) : (
                <div className="workspace-field ai-assist-pending">{t.common.pendingImage}</div>
              )}
            </section>
          </div>
          {ai.error && (
            <p className="ai-assist-feedback is-error" role="alert">
              {ai.error}
            </p>
          )}
        </div>
        <footer className="ai-assist-bottom">
          <div className="workspace-field workspace-composer" role="group" aria-label={t.common.generateRequirements}>
            <section className="ai-assist-options" aria-label={t.common.referenceSection}>
              <div className="ai-assist-reference-list" role="group" aria-label={t.common.referenceSection}>
                <span className="ai-assist-reference-heading">
                  {t.common.referenceHeading}
                  <HelpTip text={t.common.referenceHelp} />
                </span>
                {referenceIds.map((id) => {
                  const field = ai.capability?.fields.find((item) => item.id === id);
                  return (
                    <div className="workspace-tag ai-assist-reference-row" key={id}>
                      <Checkbox
                        className="workspace-toggle"
                        checked={ai.references.includes(id)}
                        disabled={ai.busy}
                        aria-label={t.common.referenceAs(field?.name ?? id)}
                        onChange={(event) =>
                          ai.setReferences((current) =>
                            event.currentTarget.checked
                              ? [...new Set([...current, id])]
                              : current.filter((item) => item !== id),
                          )
                        }
                      >
                        {field?.name ?? id}
                      </Checkbox>
                    </div>
                  );
                })}
              </div>
            </section>
            <textarea
              className="workspace-field workspace-composer-instruction"
              rows={2}
              maxLength={4000}
              placeholder={t.contentImage.instructionPlaceholder}
              aria-label={t.contentImage.instructionAria}
              value={ai.instruction}
              disabled={ai.busy}
              onChange={(event) => ai.setInstruction(event.currentTarget.value)}
            />
            <div className="workspace-composer-controls">
              <Button
                ref={sizeAnchor}
                type="button"
                variant="quiet"
                className="workspace-composer-choice"
                icon="sliders-horizontal"
                aria-label={t.common.sizeAndQuality}
                aria-haspopup="dialog"
                aria-expanded={sizeOpen}
                aria-controls={sizeOpen ? sizeId : undefined}
                disabled={ai.busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setSizeOpen((value) => !value)}
              >
                <span className="workspace-composer-meta" data-ai-image-summary>
                  {sizeLabel} · {t.imageAI.qualities[articleImageQualityKeys[qualityIndex] ?? 'auto']}
                </span>
                <Icon name="chevron-down" />
              </Button>
            </div>
            <div className="workspace-toolbar-actions">
              <AIModelPicker
                label={t.common.imageModel}
                models={(ai.capability?.models ?? []).filter((model) => model.imageEnabled)}
                value={ai.modelId}
                disabled={ai.busy}
                onChange={ai.setModelId}
              />
              <Button
                type="button"
                variant="primary"
                className="workspace-composer-send"
                icon={ai.phase === 'generating' ? 'square' : 'arrow-up'}
                aria-label={ai.phase === 'generating' ? t.common.stopGenerate : t.common.generateImage}
                title={ai.phase === 'generating' ? t.common.stopGenerate : t.common.generateImage}
                disabled={
                  ai.phase === 'loading' || ai.phase === 'applying' || (!canGenerate && ai.phase !== 'generating')
                }
                onClick={() => (ai.phase === 'generating' ? ai.stop() : void ai.generate())}
              />
            </div>
          </div>
          {ai.result && (
            <div className="ai-assist-footer desk-article-image-footer">
              <label>
                {t.common.usageLabel}
                <Select
                  className="workspace-field"
                  value={ai.use}
                  aria-label={t.common.usageAria}
                  disabled={ai.busy}
                  onChange={(event) => ai.setUse(event.currentTarget.value as 'append' | 'replace' | 'library')}
                >
                  <option value="append">{t.contentImage.insertAtCursor}</option>
                  <option value="replace" disabled={!selection || selection.start === selection.end}>
                    {t.contentImage.replaceSelection}
                  </option>
                  <option value="library">{t.common.libraryOnly}</option>
                </Select>
              </label>
              <Button
                type="button"
                variant="primary"
                disabled={ai.busy || (ai.use === 'replace' && selection?.start === selection?.end)}
                onClick={() => void ai.apply()}
              >
                {applyLabel}
              </Button>
            </div>
          )}
        </footer>
        <AIPanelResizers gesture={gesture} />
      </AnchorPopover>
      <AnchorPopover
        as="div"
        id={sizeId}
        open={sizeOpen && ai.open}
        anchor={sizeAnchor}
        role="dialog"
        aria-label={t.common.sizeAndQuality}
        className="desk-form-ai-picker ai-assist-picker workspace-app workspace-scrollbars"
        placement="top-end"
        gap={6}
        dismissOnFocusOutside
        onClose={() => setSizeOpen(false)}
      >
        <fieldset className="ai-assist-picker-section">
          <legend>{t.contentImage.ratioTitle}</legend>
          <div className="ai-assist-size-options">
            {articleImageSizeKeys.map((value) => {
              const entry = t.imageAI.sizes[value];
              return (
                <Button
                  key={value}
                  type="button"
                  variant="quiet"
                  className="ai-assist-picker-option"
                  aria-pressed={ai.size === value}
                  title={entry.detail || entry.label}
                  disabled={ai.busy}
                  onClick={() => {
                    ai.setSize(value);
                    setSizeOpen(false);
                  }}
                >
                  <span>{entry.label}</span>
                  {entry.detail && <span className="ai-assist-picker-caption">{entry.detail}</span>}
                  <span className="ai-assist-picker-check" aria-hidden="true">
                    <Icon name="check" />
                  </span>
                </Button>
              );
            })}
          </div>
        </fieldset>
        {ai.size === 'custom' && (
          <div className="ai-assist-image-custom" data-ai-image-custom>
            <label>
              {t.contentImage.width}
              <input
                className="workspace-field"
                type="number"
                min="1"
                max="3840"
                step="1"
                value={ai.customWidth}
                aria-label={t.contentImage.widthAria}
                disabled={ai.busy}
                onChange={(event) => ai.setCustomWidth(event.currentTarget.value)}
              />
            </label>
            <span aria-hidden="true">:</span>
            <label>
              {t.contentImage.height}
              <input
                className="workspace-field"
                type="number"
                min="1"
                max="3840"
                step="1"
                value={ai.customHeight}
                aria-label={t.contentImage.heightAria}
                disabled={ai.busy}
                onChange={(event) => ai.setCustomHeight(event.currentTarget.value)}
              />
            </label>
            {!validArticleImageSize(`${ai.customWidth}x${ai.customHeight}`) && (
              <p className="ai-assist-feedback is-error" role="alert">
                {t.contentImage.sizeInvalid}
              </p>
            )}
          </div>
        )}
        <fieldset className="ai-assist-picker-section ai-assist-quality">
          <legend>{t.common.qualityTitle}</legend>
          <output>{t.imageAI.qualities[articleImageQualityKeys[qualityIndex] ?? 'auto']}</output>
          <input
            className="workspace-range"
            style={rangeFill(qualityIndex, articleImageQualityKeys.length - 1)}
            type="range"
            min="0"
            max={articleImageQualityKeys.length - 1}
            step="1"
            value={qualityIndex}
            aria-label={t.common.qualityAria}
            aria-valuetext={t.imageAI.qualities[articleImageQualityKeys[qualityIndex] ?? 'auto']}
            disabled={ai.busy}
            onChange={(event) => {
              const next = articleImageQualityKeys[Number(event.currentTarget.value)];
              if (next) ai.setQuality(next);
            }}
          />
          <div className="ai-assist-quality-ticks" aria-hidden="true">
            {articleImageQualityKeys.map((value) => (
              <span key={value}>{t.imageAI.qualities[value]}</span>
            ))}
          </div>
        </fieldset>
      </AnchorPopover>
    </>
  );
}
