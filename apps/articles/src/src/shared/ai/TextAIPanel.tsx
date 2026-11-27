import { useState, type ReactNode } from 'react';
import { Button, Checkbox, HelpTip, Select, WindowTitlebar, type AIResultState, type IconName } from '@xyzos/desk-ui';
import { AIModelPicker } from './AIModelPicker';
import { AIPanelResizers, type useAIPanelGesture } from './useAIPanelGesture';
import './form-ai.css';
import './text-ai.css';
import { aiMessages, type AiMessages } from './locale';
import { useMessages } from '@xyzos/desk-ui';

export const textAIActionIcons: Record<string, IconName> = {
  polish: 'sparkles',
  expand: 'expand',
  shorten: 'align-left',
  translate: 'languages',
  custom: 'wand-sparkles',
  image: 'image-plus',
  sql_generate: 'code-xml',
  html_edit: 'code-xml',
};

/** 与原站 `ai-assist.js` 各动作的输入提示一致；按当前语言取。 */
export const textAIPlaceholders = (t: AiMessages): Record<string, string> => t.placeholders;

export interface TextAIPanelReference {
  id: string;
  label: string;
  content: string;
  readOnly?: boolean;
}

export interface TextAIPanelProps {
  /** 标题栏文字，默认取当前动作名称。 */
  title?: string;
  actions: readonly { id: string; name: string }[];
  action: string;
  onAction: (id: string) => void;
  models: readonly { id: string; name: string }[];
  model: string;
  onModel: (id: string) => void;
  languages: readonly string[];
  language: string;
  onLanguage: (value: string) => void;
  instruction: string;
  onInstruction: (value: string) => void;
  instructionLabel?: string;
  instructionPlaceholder?: string;
  /** 选区：用于“替换范围 / 追加位置”提示，偏移为 UTF-16 下标。 */
  point?: { source: string; start: number; end: number; caret?: number };
  original: string;
  output: string;
  onOutput: (value: string) => void;
  state: AIResultState;
  error?: string;
  feedback?: string;
  references?: readonly TextAIPanelReference[];
  selectedReferences?: readonly string[];
  onReferences?: (next: string[]) => void;
  busy: boolean;
  disabled?: boolean;
  generateDisabled?: boolean;
  onGenerate: () => void;
  onStop: () => void;
  onClose: () => void;
  onApply?: (value: string) => void;
  applyLabel?: string;
  onAppend?: (value: string) => void;
  appendLabel?: string;
  canUndo?: boolean;
  onUndo?: () => void;
  undoLabel?: string;
  resultLabel?: string;
  /** 提示词预览入口；省略则不显示调试按钮。 */
  prompt?: { content: string; error: string; busy: boolean; preview: () => void; close: () => void };
  /** 内容区顶部的额外提示，例如配置读取失败。 */
  notice?: ReactNode;
  gesture: ReturnType<typeof useAIPanelGesture>;
}

function lineColumn(source: string, offset: number, format: AiMessages['lineColumn']) {
  const lines = source.slice(0, offset).split('\n');
  return format(lines.length, [...(lines.at(-1) ?? '')].length + 1);
}

/**
 * 快捷工具窗口内容，沿原站 `.ai-assist-popover` 的结构：标题栏、动作网格、原文 / 结果对比、
 * 应用 / 撤销行，以及带参考、补充要求、模型按钮和圆形生成键的底部输入区。
 * 只负责展示和回调；请求、权限与写回由宿主处理。
 */
export function TextAIPanel(props: TextAIPanelProps) {
  const t = useMessages(aiMessages);
  const {
    actions,
    action,
    models,
    state,
    busy,
    disabled = false,
    references = [],
    selectedReferences = [],
    prompt,
    point,
  } = props;
  const [detail, setDetail] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const blocked = busy || disabled;
  const current = actions.find((item) => item.id === action);
  const detailItem = references.find((item) => item.id === detail);
  const ready = state === 'ready' && !props.error && props.output.trim().length > 0 && !disabled;
  const showOutput = state !== 'idle' || props.output !== '';
  const caret = point?.caret ?? point?.end ?? 0;
  const toggleReference = (id: string) =>
    props.onReferences?.(
      selectedReferences.includes(id) ? selectedReferences.filter((item) => item !== id) : [...selectedReferences, id],
    );

  return (
    <>
      <WindowTitlebar
        as="header"
        className="win-titlebar ai-assist-head"
        title={props.title ?? current?.name ?? t.quickTools}
        controls={['close']}
        onClose={props.onClose}
        {...props.gesture.handleProps}
      />
      <div className="ai-assist-actions" role="group" aria-label={t.chooseAction}>
        {actions.map((item) => (
          <Button
            key={item.id}
            type="button"
            icon={textAIActionIcons[item.id] ?? 'sparkles'}
            pressed={item.id === action}
            disabled={blocked}
            onClick={() => props.onAction(item.id)}
          >
            <span>{item.name}</span>
          </Button>
        ))}
      </div>
      <div className="ai-assist-body">
        {props.notice}
        {point && (
          <div className="ai-assist-feedback" data-ai-position>
            {t.rangeHint(
              lineColumn(point.source, point.start, t.lineColumn),
              lineColumn(point.source, point.end, t.lineColumn),
              lineColumn(point.source, caret, t.lineColumn),
            )}
          </div>
        )}
        <div className="ai-assist-comparison is-comparing" data-ai-comparison>
          <section className="ai-assist-compare-pane" data-ai-source aria-label={t.original}>
            <header className="workspace-field-heading">
              <strong>{t.original}</strong>
            </header>
            <pre className="workspace-field" data-ai-original tabIndex={0} aria-label={t.originalReference}>
              {props.original}
            </pre>
          </section>
          <section className="ai-assist-compare-pane ai-assist-preview" data-ai-preview aria-label={t.result}>
            <header className="workspace-field-heading">
              <strong>{props.resultLabel ?? t.optimized}</strong>
            </header>
            {showOutput && (props.output !== '' || state === 'ready' || state === 'error') ? (
              <textarea
                className="workspace-field ai-assist-output"
                data-ai-output
                rows={6}
                aria-label={t.suggestionEditable}
                aria-invalid={Boolean(props.error) || undefined}
                value={props.output}
                readOnly={state !== 'ready' || disabled}
                onChange={(event) => props.onOutput(event.currentTarget.value)}
              />
            ) : (
              <div className="workspace-field ai-assist-pending" data-ai-pending role="status">
                {state === 'generating' && (
                  <div className="ai-assist-progress" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                )}
                <span className="ai-assist-feedback" data-ai-pending-label>
                  {state === 'generating' ? t.generatingStoppable : t.pending}
                </span>
              </div>
            )}
          </section>
        </div>
        {props.error && (
          <p className="ai-assist-feedback is-error" role="alert">
            {props.error}
          </p>
        )}
        {props.feedback && !props.error && (
          <p className="ai-assist-feedback" role="status">
            {props.feedback}
          </p>
        )}
        {promptOpen && prompt && (
          <section className="ai-assist-prompt" data-ai-prompt aria-label={t.promptBeforeSend}>
            <header className="workspace-field-heading">
              <strong>{t.fullPrompt}</strong>
              <div className="workspace-toolbar-actions">
                <Button
                  type="button"
                  variant="quiet"
                  className="ds-button--icon"
                  icon="refresh-cw"
                  aria-label={t.refreshPrompt}
                  title={t.refreshPrompt}
                  disabled={blocked || prompt.busy}
                  onClick={prompt.preview}
                />
                <Button
                  type="button"
                  variant="quiet"
                  className="ds-button--icon"
                  icon="x"
                  aria-label={t.closePrompt}
                  onClick={() => {
                    prompt.close();
                    setPromptOpen(false);
                  }}
                />
              </div>
            </header>
            <p className={prompt.error ? 'ai-assist-feedback is-error' : 'ai-assist-feedback'} role="status">
              {prompt.error || (prompt.busy ? t.preparingPrompt : prompt.content ? '' : t.promptHint)}
            </p>
            {prompt.content && (
              <pre className="workspace-field" data-ai-prompt-content tabIndex={0} aria-label={t.promptContent}>
                {prompt.content}
              </pre>
            )}
          </section>
        )}
      </div>
      <footer className="ai-assist-bottom">
        {(ready || props.canUndo) && (
          <div className="ai-assist-footer">
            {props.onApply && (
              <Button type="button" variant="primary" disabled={!ready} onClick={() => props.onApply?.(props.output)}>
                {props.applyLabel ?? t.apply}
              </Button>
            )}
            {props.onAppend && (
              <Button type="button" disabled={!ready} onClick={() => props.onAppend?.(props.output)}>
                {props.appendLabel ?? t.appendAtCaret}
              </Button>
            )}
            {props.canUndo && (
              <Button type="button" icon="undo-2" disabled={busy} onClick={props.onUndo}>
                {props.undoLabel ?? t.undo}
              </Button>
            )}
          </div>
        )}
        <div className="workspace-field workspace-composer" data-ai-composer role="group" aria-label={t.composer}>
          {references.length > 0 && (
            <section className="ai-assist-options" data-ai-references aria-label={t.references}>
              <div className="ai-assist-reference-list" role="group" aria-label={t.references}>
                <span className="ai-assist-reference-heading">
                  {t.reference}
                  <HelpTip text={t.referencesHelp} />
                </span>
                {references.map((item) => (
                  <div className="workspace-tag ai-assist-reference-row" data-ai-reference-row={item.id} key={item.id}>
                    <Checkbox
                      className="workspace-toggle"
                      checked={selectedReferences.includes(item.id)}
                      disabled={blocked}
                      aria-label={t.useAsReference(item.label)}
                      onChange={() => toggleReference(item.id)}
                    >
                      {item.label}
                    </Checkbox>
                    <Button
                      type="button"
                      variant="quiet"
                      className="ds-button--icon"
                      icon="file-text"
                      aria-label={t.viewReference(item.label)}
                      title={t.viewReference(item.label)}
                      aria-expanded={detail === item.id}
                      onClick={() => setDetail((value) => (value === item.id ? '' : item.id))}
                    />
                  </div>
                ))}
              </div>
              {detailItem && (
                <pre
                  className="ai-assist-reference-detail"
                  tabIndex={0}
                  aria-label={t.referenceContent(detailItem.label)}
                >
                  {detailItem.content || t.emptyValue}
                </pre>
              )}
            </section>
          )}
          <textarea
            className="workspace-composer-instruction"
            rows={1}
            maxLength={2000}
            aria-label={props.instructionLabel ?? t.instruction}
            placeholder={props.instructionPlaceholder ?? textAIPlaceholders(t)[action] ?? t.instructionOptional}
            value={props.instruction}
            disabled={blocked}
            onChange={(event) => props.onInstruction(event.currentTarget.value)}
          />
          <div className="workspace-composer-controls">
            {action === 'translate' && (
              <Select
                aria-label={t.targetLanguage}
                value={props.language}
                disabled={blocked}
                onChange={(event) => props.onLanguage(event.currentTarget.value)}
              >
                {props.languages.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            )}
            {prompt && (
              <Button
                type="button"
                variant="quiet"
                className="ds-button--icon"
                icon="bug"
                aria-label={t.previewPrompt}
                title={t.previewPromptHint}
                aria-expanded={promptOpen}
                disabled={blocked}
                onClick={() => {
                  setPromptOpen(true);
                  prompt.preview();
                }}
              />
            )}
          </div>
          <div className="workspace-toolbar-actions">
            <AIModelPicker models={models} value={props.model} disabled={blocked} onChange={props.onModel} />
            {busy ? (
              <Button
                type="button"
                variant="primary"
                className="workspace-composer-send"
                icon="square"
                aria-label={t.stop}
                title={t.stop}
                onClick={props.onStop}
              />
            ) : (
              <Button
                type="button"
                variant="primary"
                className="workspace-composer-send"
                icon="arrow-up"
                aria-label={t.generate}
                title={t.generate}
                disabled={
                  disabled || props.generateDisabled || !current || !models.some((item) => item.id === props.model)
                }
                onClick={props.onGenerate}
              />
            )}
          </div>
        </div>
      </footer>
      <AIPanelResizers gesture={props.gesture} />
    </>
  );
}
