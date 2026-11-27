import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ContextMenu, ContextMenuDivider, ContextMenuItem, Field, Textarea, type IconName } from '@xyzos/desk-ui';
import { textSelection, type TextSelection } from './textAI';
import type { TextAIOptions } from './useTextAI';
import { aiMessages } from './locale';
import { useMessages } from '@xyzos/desk-ui';

const actionIcons: Record<string, IconName> = {
  polish: 'sparkles',
  expand: 'expand',
  shorten: 'align-left',
  translate: 'languages',
  custom: 'wand-sparkles',
};

interface TextAIContextMenuProps extends Pick<TextAIOptions, 'editor'> {
  enabled: boolean;
  actions: readonly { id: string; name: string }[];
  onAction: (action: string, selection: TextSelection) => void;
  onCut: (selection: TextSelection) => boolean;
}

export function TextAIContextMenu({ editor, enabled, actions, onAction, onCut }: TextAIContextMenuProps) {
  const t = useMessages(aiMessages);
  const [menu, setMenu] = useState<{ x: number; y: number; target: TextSelection }>();
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false);
  const version = useRef(0);
  const close = () => {
    version.current++;
    setMenu(undefined);
    setCopying(false);
  };
  const handle = useEffectEvent((event: MouseEvent) => {
    const node = editor.current;
    if (!enabled || !node || node.matches(':disabled') || node.readOnly || node.selectionStart === node.selectionEnd)
      return;
    event.preventDefault();
    event.stopPropagation();
    version.current++;
    setCopying(false);
    setError('');
    setMenu({
      x: event.clientX,
      y: event.clientY,
      target: textSelection(node.value, node.selectionStart ?? 0, node.selectionEnd ?? 0),
    });
  });
  useEffect(() => {
    const node: HTMLElement | null = editor.current;
    const listener = (event: MouseEvent) => handle(event);
    node?.addEventListener('contextmenu', listener);
    return () => node?.removeEventListener('contextmenu', listener);
  }, [editor]);
  useEffect(() => {
    alive.current = enabled;
    if (!enabled) {
      version.current++;
      setMenu(undefined);
      setCopying(false);
    }
    return () => {
      alive.current = false;
    };
  }, [enabled]);

  async function copy(cut: boolean) {
    if (!menu || copying) return;
    const expected = version.current;
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t.copyManually);
      await navigator.clipboard.writeText(menu.target.text);
      if (!alive.current || expected !== version.current) return;
      if (cut && !onCut(menu.target)) throw new Error(t.cutChanged);
      close();
    } catch (failure) {
      if (alive.current && expected === version.current)
        setError(failure instanceof Error ? failure.message : t.copyFailed);
    } finally {
      if (alive.current && expected === version.current) setCopying(false);
    }
  }

  if (!enabled || !menu) return null;
  return (
    <ContextMenu x={menu.x} y={menu.y} onClose={close} aria-label={t.selection}>
      <ContextMenuItem
        icon="copy"
        disabled={copying}
        onClick={(event) => {
          event.preventDefault();
          void copy(false);
        }}
      >
        {t.copy}
      </ContextMenuItem>
      <ContextMenuItem
        icon="scissors"
        disabled={copying}
        onClick={(event) => {
          event.preventDefault();
          void copy(true);
        }}
      >
        {t.cut}
      </ContextMenuItem>
      <ContextMenuDivider />
      {actions.map((item) => (
        <ContextMenuItem
          key={item.id}
          icon={actionIcons[item.id] ?? 'sparkles'}
          onClick={() => {
            close();
            onAction(item.id, menu.target);
          }}
        >
          {item.name}
        </ContextMenuItem>
      ))}
      {error && (
        <Field label={error}>
          <Textarea value={menu.target.text} readOnly rows={3} aria-label={t.copySelectionManually} />
        </Field>
      )}
    </ContextMenu>
  );
}
