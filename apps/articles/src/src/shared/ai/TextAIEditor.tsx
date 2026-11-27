import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnchorPopover, Button, type IconName } from '@xyzos/desk-ui';
import { TextAIContextMenu } from './TextAIContextMenu';
import { TextAIPanel, type TextAIPanelReference } from './TextAIPanel';
import { useTextAIPrompt } from './TextAIPrompt';
import { useAIPanelGesture } from './useAIPanelGesture';
import { useTextAI, type TextAIOptions } from './useTextAI';
import { type TextAITargetOptions, type TextSelection } from './textAI';
import './form-ai.css';
import './text-ai.css';
import { aiMessages } from './locale';
import { useMessages } from '@xyzos/desk-ui';

const quickActionIcons: Record<string, IconName> = {
  polish: 'wand-sparkles',
  expand: 'expand',
  shorten: 'align-left',
  translate: 'languages',
};

export interface TextAIEditorProps extends TextAIOptions {
  quickActions?: boolean;
  entryLabel?: string;
  panelTitle?: string;
  dialogLabel?: string;
  instructionLabel?: string;
  instructionPlaceholder?: string;
  resultLabel?: string;
  applyLabel?: string;
  /** 只提供这些动作（与服务端已启用的动作取交集）；用于结构化文本，避免润色、扩写等不适用的动作。 */
  actionIds?: readonly string[];
  /** 打开面板时默认勾选的只读参考字段（可编辑字段始终默认勾选），沿原站 `defaultReferenceFields`。 */
  defaultReferences?: readonly string[];
}

/** Explicit editor opt-in. The host retains draft ownership and its original save policy. */
export function TextAIEditor(props: TextAIEditorProps) {
  const t = useMessages(aiMessages);
  const ai = useTextAI(props);
  const gesture = useAIPanelGesture();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<TextSelection>();
  const [selectedReferences, setSelectedReferences] = useState<string[]>([]);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const busy = ai.busy;
  const field = props.field ?? 'text';
  const entryLabel = props.entryLabel ?? t.optimize;
  useEffect(() => {
    if (!ai.active || props.disabled) setOpen(false);
  }, [ai.active, props.disabled]);
  const enabled =
    ai.active && ai.capability?.enabled && ai.capability.textEnabled && ai.capability.textFields.includes(field);
  // 沿原站 textActions：HTML 编辑只给 HTML 格式字段，且排在最前面。
  const fieldFormat = ai.capability?.fields.find((item) => item.id === field)?.format;
  const actions = useMemo(
    () =>
      (ai.capability?.actions ?? [])
        .filter((item) => item.id !== 'html_edit' || fieldFormat === 'html')
        .filter((item) => !props.actionIds || props.actionIds.includes(item.id))
        .sort((left, right) => Number(right.id === 'html_edit') - Number(left.id === 'html_edit')),
    [ai.capability?.actions, fieldFormat, props.actionIds],
  );
  const references: TextAIPanelReference[] = useMemo(() => {
    const capability = ai.capability;
    if (!props.referenceValues || !capability) return [];
    return capability.referenceFields.flatMap((referenceId) => {
      const item = capability.fields.find((entry) => entry.id === referenceId);
      const content = referenceId === field ? props.value : (props.referenceValues?.[referenceId] ?? '');
      if (!item || !content.trim()) return [];
      return [
        {
          id: referenceId,
          label:
            referenceId === field
              ? t.referenceFull(item.name)
              : item.readOnly
                ? t.referenceReadOnly(item.name)
                : item.name,
          content,
          readOnly: item.readOnly,
        },
      ];
    });
  }, [ai.capability, field, props.referenceValues, props.value, t]);
  const targetOptions: TextAITargetOptions = {
    target: props.target,
    field,
    identity: props.identity,
    allowEmpty: props.allowEmpty,
    references: props.referenceValues
      ? { values: { ...props.referenceValues, [field]: props.value }, selected: selectedReferences }
      : undefined,
  };
  const prompt = useTextAIPrompt({
    capability: ai.capability,
    selection: target,
    action: ai.action,
    model: ai.model,
    language: ai.language,
    instruction: ai.instruction,
    targetOptions,
    disabled: busy || props.disabled,
  });
  const close = () => {
    ai.discard();
    prompt.close();
    setOpen(false);
  };
  const show = (selection = ai.capture(), action = actions[0]?.id ?? '') => {
    const targetSelection = props.wholeField ? ai.captureWhole() : selection;
    ai.discard();
    ai.setAction(action);
    ai.setModel(ai.capability?.defaultModelId || ai.capability?.models[0]?.id || '');
    ai.setLanguage(ai.capability?.language || ai.capability?.languages[0] || '');
    ai.setInstruction('');
    setSelectedReferences(
      references.filter((item) => !item.readOnly || props.defaultReferences?.includes(item.id)).map((item) => item.id),
    );
    setTarget(targetSelection);
    setOpen(true);
  };

  // 沿原站 bindText：未开启快速动作时，工具栏只放「AI 优化」入口；撤销与“已应用”提示留在面板内，
  // 只有快速动作（无面板）才在入口旁显示停止 / 撤销与结果提示。错误在面板关闭时仍在入口旁提示。
  const quick = props.quickActions !== false;
  const inlineFeedback = open ? '' : ai.error || (quick ? ai.feedback : '');
  if (!ai.active) return null;
  return (
    <>
      <span className="desk-text-ai-actions" role="group" aria-label={t.textActions}>
        {inlineFeedback && (
          <span className="desk-text-ai-feedback" role={ai.error ? 'alert' : 'status'}>
            {inlineFeedback}
          </span>
        )}
        {enabled &&
          quick &&
          !busy &&
          ai.capability?.actions
            .filter((item) => !['custom', 'html_edit'].includes(item.id))
            .map((item) => (
              <Button
                key={item.id}
                className="workspace-button ai-assist-entry"
                icon={quickActionIcons[item.id] ?? 'sparkles'}
                disabled={props.disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void ai.generate(item.id, true)}
              >
                {t.oneClick(item.name)}
              </Button>
            ))}
        {busy && !open && (
          <Button className="workspace-button ai-assist-entry" icon="square" onClick={ai.stop}>
            {t.stop}
          </Button>
        )}
        {quick && ai.canUndo && !busy && !open && (
          <Button
            className="workspace-button ai-assist-entry"
            icon="undo-2"
            disabled={props.disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={ai.undo}
          >
            {t.undo}
          </Button>
        )}
        {(enabled || ai.error) && (
          <Button
            ref={anchor}
            icon="sparkles"
            disabled={props.disabled || busy}
            className="workspace-button ai-assist-entry"
            data-ai-editor-mode="text"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => (open ? close() : show())}
          >
            <span>{entryLabel}</span>
          </Button>
        )}
      </span>
      <AnchorPopover
        as="section"
        open={open && !props.disabled}
        anchor={anchor}
        onClose={close}
        dismissOnFocusOutside={false}
        id={id}
        role="dialog"
        aria-label={props.dialogLabel ?? ai.capability?.actions.find((a) => a.id === ai.action)?.name ?? t.textEdit}
        aria-busy={busy}
        className="desk-form-ai-layer desk-text-ai-layer ai-assist-popover workspace-app workspace-scrollbars"
        placement="bottom-start"
        gap={8}
        {...gesture.panelProps}
      >
        <TextAIPanel
          gesture={gesture}
          title={props.panelTitle}
          actions={actions}
          action={ai.action}
          onAction={ai.setAction}
          models={ai.capability?.models ?? []}
          model={ai.model}
          onModel={ai.setModel}
          languages={ai.capability?.languages ?? []}
          language={ai.language}
          onLanguage={ai.setLanguage}
          instruction={ai.instruction}
          onInstruction={ai.setInstruction}
          instructionLabel={props.instructionLabel}
          instructionPlaceholder={props.instructionPlaceholder}
          point={target && !props.wholeField ? target : undefined}
          original={ai.selection?.text ?? target?.text ?? ''}
          output={ai.output}
          onOutput={ai.setOutput}
          state={ai.state}
          error={ai.error || undefined}
          feedback={ai.feedback || undefined}
          resultLabel={props.resultLabel}
          references={references}
          selectedReferences={selectedReferences}
          onReferences={setSelectedReferences}
          busy={busy}
          disabled={!enabled || props.disabled || ai.applying}
          generateDisabled={!target?.text.trim() && !(props.allowEmpty && ai.instruction.trim())}
          onGenerate={() => void ai.generate(ai.action, false, target, selectedReferences)}
          onStop={ai.stop}
          onClose={close}
          onApply={(value) => {
            void ai.apply(value);
          }}
          applyLabel={props.applyLabel}
          canUndo={ai.canUndo}
          onUndo={ai.undo}
          prompt={ai.capability?.promptPreviewEnabled && target ? prompt : undefined}
          notice={
            !enabled && ai.error ? (
              <div role="alert">
                {ai.error}
                <Button size="sm" onClick={ai.reload}>
                  {t.reloadConfig}
                </Button>
              </div>
            ) : undefined
          }
        />
      </AnchorPopover>
      <TextAIContextMenu
        editor={props.editor}
        enabled={!!enabled && !props.disabled && !busy}
        actions={actions}
        onAction={(action, selection) => show(selection, action)}
        onCut={ai.cut}
      />
    </>
  );
}
