import { useId, useRef, useState } from 'react';
import { AnchorPopover, Button, Icon } from '@xyzos/desk-ui';
import './form-ai.css';
import { aiMessages } from './locale';
import { useMessages } from '@xyzos/desk-ui';

/** 输入区右侧的模型按钮（名称 + 箭头），点开列出可选模型；对应原站 `data-ai-picker="model"`。 */
export function AIModelPicker({
  models,
  value,
  disabled,
  label: labelOverride,
  onChange,
}: {
  models: readonly { id: string; name: string }[];
  value: string;
  disabled?: boolean;
  label?: string;
  onChange: (id: string) => void;
}) {
  const t = useMessages(aiMessages);
  const label = labelOverride ?? t.chooseModel;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  return (
    <>
      <Button
        ref={anchor}
        type="button"
        variant="quiet"
        className="workspace-composer-choice"
        data-ai-picker="model"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="workspace-composer-meta" data-ai-model>
          {models.find((item) => item.id === value)?.name}
        </span>
        <Icon name="chevron-down" />
      </Button>
      <AnchorPopover
        as="section"
        id={id}
        open={open}
        anchor={anchor}
        role="dialog"
        aria-label={label}
        className="desk-form-ai-picker ai-assist-picker workspace-app workspace-scrollbars"
        placement="top-end"
        onClose={() => setOpen(false)}
      >
        <fieldset className="ai-assist-picker-section" data-ai-model-options>
          <legend>{t.model}</legend>
          {models.map((model) => (
            <Button
              key={model.id}
              className="ai-assist-picker-option"
              type="button"
              variant="quiet"
              aria-pressed={value === model.id}
              title={model.name}
              onClick={() => {
                onChange(model.id);
                setOpen(false);
              }}
            >
              <span>{model.name}</span>
              <span className="ai-assist-picker-check" aria-hidden="true">
                <Icon name="check" />
              </span>
            </Button>
          ))}
        </fieldset>
      </AnchorPopover>
    </>
  );
}
