import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import { AnchorPopover, Button, Checkbox, Textarea, WindowTitlebar } from '@xyzos/desk-ui';
import { AIModelPicker } from './AIModelPicker';
import { AIPanelResizers, useAIPanelGesture } from './useAIPanelGesture';
import { useFormAI, type FormAIOptions } from './useFormAI';
import './form-ai.css';
import { aiMessages } from './locale';
import { useMessages } from '@xyzos/desk-ui';

export function FormAIEditor(props: FormAIOptions) {
  const t = useMessages(aiMessages);
  const ai = useFormAI(props);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const anchor = useRef<HTMLElement | null>(null);
  const gesture = useAIPanelGesture();
  const id = useId();
  const capability = ai.capability;
  const fields = useMemo(
    () =>
      capability?.fields.filter(
        (field) =>
          capability.referenceFields.includes(field.id) ||
          (capability.generateFields ?? capability.writeFields).includes(field.id),
      ) ?? [],
    [capability],
  );
  const canGenerate = (fieldId: string) => {
    if (!capability) return false;
    return (
      capability.fields.some((field) => field.id === fieldId) &&
      (capability.generateFields ?? capability.writeFields).includes(fieldId)
    );
  };
  const canSelectGenerate = (fieldId: string) => {
    if (!capability || !canGenerate(fieldId)) return false;
    const field = capability.fields.find((item) => item.id === fieldId);
    return !field?.suggestable || !field.optionsRequired || !!props.referenceOptions?.[fieldId]?.length;
  };
  const hasGenerationTarget =
    !!capability?.enabled && !!capability.formEnabled && fields.some((field) => canSelectGenerate(field.id));
  const close = () => {
    ai.discard();
    setOpen(false);
  };
  useEffect(() => {
    if (!ai.active) {
      setOpen(false);
    }
  }, [ai.active]);
  const show = (event: MouseEvent<HTMLButtonElement>) => {
    if (!capability?.enabled || !capability.formEnabled || !ai.allowed) return;
    if (open) {
      close();
      return;
    }
    anchor.current = event.currentTarget;
    ai.discard();
    const requested = fields
      .filter((field) => canSelectGenerate(field.id) && !props.fields[field.id]?.trim())
      .map((field) => field.id);
    const references = capability.referenceFields.filter(
      (fieldId) => !capability.fields.find((field) => field.id === fieldId)?.readOnly,
    );
    ai.setRequestedFields(requested);
    ai.setContextFields(references);
    setExpanded(
      new Set(
        fields
          .filter((field) => !props.fields[field.id]?.trim() || references.includes(field.id))
          .map((field) => field.id),
      ),
    );
    setOpen(true);
  };
  const toggle = (fieldId: string, value: readonly string[], setter: (next: string[]) => void) => {
    setter(value.includes(fieldId) ? value.filter((item) => item !== fieldId) : [...value, fieldId]);
  };
  return (
    <>
      <Button
        className="desk-form-ai-entry workspace-button"
        type="button"
        icon="sparkles"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        hidden={!hasGenerationTarget}
        disabled={!ai.allowed || !capability?.formEnabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={show}
      >
        {t.smartComplete}
      </Button>
      {/* 沿原站 bindForm：“已应用 / 已撤销”只在面板内提示，面板关闭后入口旁只保留错误。 */}
      {!open && ai.error && (
        <span className="desk-form-ai-feedback" role="alert">
          {ai.error}
        </span>
      )}
      <AnchorPopover
        as="section"
        id={id}
        open={open}
        anchor={anchor}
        role="dialog"
        aria-label={t.smartComplete}
        className="desk-form-ai-layer ai-assist-popover workspace-app workspace-scrollbars"
        placement="bottom-start"
        gap={8}
        {...gesture.panelProps}
        dismissOnFocusOutside={false}
        onClose={close}
        aria-busy={ai.busy}
      >
        <WindowTitlebar
          as="header"
          className="win-titlebar ai-assist-head"
          title={t.smartComplete}
          controls={['close']}
          {...gesture.handleProps}
          onClose={close}
        />
        <div className="ai-assist-body">
          {!capability && (
            <div
              className={ai.error ? 'ai-assist-feedback is-error' : 'ai-assist-feedback'}
              role={ai.error ? 'alert' : 'status'}
            >
              {ai.error || t.loadingConfig}
            </div>
          )}
          {capability && fields.length === 0 && (
            <p className="ai-assist-feedback" role="status">
              {t.noFields}
            </p>
          )}
          <div className="ai-assist-feedback" data-ai-position hidden />
          <pre className="workspace-field" data-ai-source-map tabIndex={0} aria-label={t.sourceMap} hidden />
          {capability && fields.length > 0 && (
            <div className="ai-assist-comparison" data-ai-comparison>
              <section className="ai-assist-compare-pane ai-assist-preview" aria-label={t.fieldPreview}>
                <header className="ai-assist-reference-heading">
                  <strong>{t.fieldCompare}</strong>
                </header>
                <div className="workspace-field ai-assist-pending" data-ai-pending hidden={ai.state !== 'generating'}>
                  <div className="ai-assist-progress" data-ai-progress aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="ai-assist-feedback" data-ai-pending-label>
                    {t.generating}
                  </span>
                </div>
                <div data-ai-results>
                  <div className="ai-assist-form-fields" data-ai-form-fields>
                    {fields.map((field) => {
                      const value = props.fields[field.id] ?? '';
                      const requestable = canGenerate(field.id);
                      const selectable = canSelectGenerate(field.id);
                      const referenceable = capability.referenceFields.includes(field.id);
                      const hasResult = Object.hasOwn(ai.results, field.id);
                      const isExpanded = expanded.has(field.id);
                      const comparisonId = id + '-' + field.id;
                      return (
                        <section
                          key={field.id}
                          className="ai-assist-result-field"
                          data-ai-form-field={field.id}
                          aria-label={field.name}
                        >
                          <header className="ai-assist-field-heading">
                            <span className="ai-assist-field-title">
                              <strong>{field.name}</strong>
                              {requestable && (
                                <span className="workspace-count" data-ai-field-hint hidden={!value.trim()}>
                                  {t.hasContent}
                                </span>
                              )}
                            </span>
                            <div className="workspace-toolbar-actions">
                              <span data-ai-reference-heading>
                                {referenceable && (
                                  <Checkbox
                                    className="workspace-toggle"
                                    checked={ai.contextFields.includes(field.id)}
                                    disabled={ai.busy}
                                    aria-label={t.useAsReference(field.name)}
                                    onChange={() => toggle(field.id, ai.contextFields, ai.setContextFields)}
                                  >
                                    {t.reference}
                                  </Checkbox>
                                )}
                              </span>
                              <span data-ai-request-heading>
                                {requestable && (
                                  <Checkbox
                                    className="workspace-toggle"
                                    checked={ai.requestedFields.includes(field.id)}
                                    disabled={ai.busy || !selectable}
                                    title={selectable ? t.selectHint : t.noOptions}
                                    aria-label={t.completeField(field.name, !!value.trim())}
                                    onChange={() => {
                                      toggle(field.id, ai.requestedFields, ai.setRequestedFields);
                                      setExpanded((current) => new Set(current).add(field.id));
                                    }}
                                  >
                                    {value.trim() ? t.regenerate : t.complete}
                                  </Checkbox>
                                )}
                              </span>
                              <Button
                                className="ai-assist-field-toggle"
                                type="button"
                                variant="quiet"
                                icon="chevron-right"
                                aria-expanded={isExpanded}
                                aria-controls={comparisonId}
                                aria-label={t.toggleField(field.name, isExpanded)}
                                onClick={() =>
                                  setExpanded((current) => {
                                    const next = new Set(current);
                                    if (next.has(field.id)) next.delete(field.id);
                                    else next.add(field.id);
                                    return next;
                                  })
                                }
                              />
                            </div>
                          </header>
                          <div
                            id={comparisonId}
                            className={
                              'ai-assist-field-comparison' +
                              (field.maxLength > 500 ? ' is-long-field' : '') +
                              (!requestable ? ' is-reference-only' : '')
                            }
                            data-ai-field-comparison={field.id}
                            hidden={!isExpanded}
                          >
                            <section className="ai-assist-compare-pane">
                              <div className="workspace-field workspace-field-group">
                                <header className="workspace-field-heading" data-ai-field-current-heading>
                                  <span className="workspace-toolbar-title">{t.currentContent}</span>
                                  {referenceable && (
                                    <div className="ai-assist-current-reference" data-ai-field-reference hidden />
                                  )}
                                </header>
                                <pre
                                  className="workspace-field-content"
                                  data-ai-field-original
                                  data-ai-field-current={field.id}
                                  tabIndex={0}
                                  aria-label={t.currentOf(field.name)}
                                >
                                  {value || t.emptyValue}
                                </pre>
                              </div>
                            </section>
                            {requestable && (
                              <section className="ai-assist-compare-pane" data-ai-field-output={field.id}>
                                <div className="workspace-field workspace-field-group">
                                  <header className="workspace-field-heading">
                                    <span className="workspace-toolbar-title">{t.generatedContent}</span>
                                    <div className="workspace-toolbar-actions">
                                      <span data-ai-request-output />
                                      <span data-ai-field-result-choice hidden={!hasResult}>
                                        {hasResult && (
                                          <Checkbox
                                            className="workspace-toggle"
                                            checked={ai.selectedResults.includes(field.id)}
                                            disabled={ai.busy}
                                            aria-label={t.applyOf(field.name)}
                                            onChange={() => toggle(field.id, ai.selectedResults, ai.setSelectedResults)}
                                          >
                                            {t.apply}
                                          </Checkbox>
                                        )}
                                      </span>
                                    </div>
                                  </header>
                                  <div
                                    className={
                                      'workspace-field-content ai-assist-field-result-body' +
                                      (!hasResult ? ' ai-assist-field-placeholder' : '')
                                    }
                                    data-ai-field-result-body
                                  >
                                    {hasResult ? (
                                      <Textarea
                                        className="workspace-field-content"
                                        rows={field.maxLength > 500 ? 3 : 1}
                                        maxLength={field.maxLength}
                                        aria-label={t.suggestionOf(field.name)}
                                        value={ai.results[field.id] ?? ''}
                                        disabled={ai.busy}
                                        onChange={(event) => ai.setResult(field.id, event.currentTarget.value)}
                                      />
                                    ) : (
                                      <span className="ai-assist-feedback" data-ai-field-pending>
                                        {t.pending}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </section>
                            )}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
              </section>
            </div>
          )}
          {ai.error && (
            <p className="ai-assist-feedback is-error" role="alert">
              {ai.error}
            </p>
          )}
          {ai.feedback && (
            <p className="ai-assist-feedback" role="status">
              {ai.feedback}
            </p>
          )}
        </div>
        <footer className="ai-assist-bottom">
          <div className="ai-assist-status" data-ai-status hidden={!ai.error && !ai.feedback && ai.state !== 'ready'}>
            <p
              className={ai.error ? 'ai-assist-feedback is-error' : 'ai-assist-feedback'}
              role={ai.error ? 'alert' : 'status'}
            >
              {ai.error || ai.feedback || (ai.state === 'ready' ? t.readyPick : '')}
            </p>
            {ai.state === 'ready' && (
              <Button
                type="button"
                variant="primary"
                disabled={!ai.selectedResults.length || !ai.allowed}
                onClick={() => void ai.apply()}
              >
                {t.applySelected}
              </Button>
            )}
          </div>
          <div className="ai-assist-footer" hidden={!ai.canUndo}>
            {ai.canUndo && (
              <Button type="button" icon="undo-2" onClick={ai.undo}>
                {t.undo}
              </Button>
            )}
          </div>
          <div className="workspace-field workspace-composer" data-ai-composer role="group" aria-label={t.composer}>
            <Textarea
              className="workspace-composer-instruction"
              rows={1}
              maxLength={2000}
              aria-label={t.instruction}
              value={ai.instruction}
              disabled={ai.busy || !ai.allowed}
              placeholder={t.instructionOptional}
              onChange={(event) => ai.setInstruction(event.currentTarget.value)}
            />
            <div className="workspace-composer-controls" />
            <div className="workspace-toolbar-actions">
              <AIModelPicker models={capability?.models ?? []} value={ai.model} onChange={ai.setModel} />
              {ai.busy ? (
                <Button
                  className="workspace-composer-send"
                  type="button"
                  variant="primary"
                  icon="square"
                  aria-label={t.stop}
                  title={t.stop}
                  onClick={ai.stop}
                />
              ) : (
                <Button
                  className="workspace-composer-send"
                  type="button"
                  variant="primary"
                  icon="arrow-up"
                  aria-label={t.generate}
                  title={t.generate}
                  disabled={
                    !ai.allowed ||
                    !capability?.formEnabled ||
                    !ai.requestedFields.length ||
                    (!ai.contextFields.length && !ai.instruction.trim())
                  }
                  onClick={() => void ai.generate()}
                />
              )}
            </div>
          </div>
        </footer>
        <AIPanelResizers gesture={gesture} />
      </AnchorPopover>
    </>
  );
}
