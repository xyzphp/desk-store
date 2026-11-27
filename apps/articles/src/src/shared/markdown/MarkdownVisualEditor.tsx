import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { Select, Icon } from '@xyzos/desk-ui';
import { SandboxMarkdownView as MarkdownView } from './SandboxMarkdownView';
import type { MarkdownVisualMedia, MarkdownVisualSelection } from './visual';
import { normalizeVisualMarkdownBlock, serializeVisualMarkdownSelection, updateVisualMarkdownImages } from './visual';
import { markdownMessages } from './locale';
import { useMessages } from '@xyzos/desk-ui';

export type MarkdownVisualMode = 'edit' | 'split' | 'preview';

interface VisualImage {
  index: number;
  reference: string;
  groupIndexes: number[];
  width: number;
  widthAttribute: number;
  columns: number;
}

interface VisualMarker {
  source: string;
  start: number;
  end: number;
  startToken: string;
  endToken: string;
}

interface VisualResize {
  pointerId: number;
  startX: number;
  startWidth: number;
  width: number;
  widthAttribute: number;
  image: number;
  groupIndexes: number[];
}

export interface MarkdownVisualEditorHandle {
  selection(): MarkdownVisualSelection;
  focus(): void;
}

interface Props {
  ref?: Ref<MarkdownVisualEditorHandle>;
  dataAttributes?: Readonly<Record<`data-${string}`, string>>;
  id: string;
  className: string;
  editableLabel: string;
  readonlyLabel: string;
  placeholder: string;
  maxLength: number;
  maxLengthMessage: string;
  renderSource: string;
  value: string;
  media: Readonly<Record<string, MarkdownVisualMedia>>;
  mode: MarkdownVisualMode;
  editable: boolean;
  busy: boolean;
  selection: readonly [number, number];
  restore: { revision: number; start: number; end: number };
  panelHost: HTMLElement | null;
  onChange(value: string, start: number, end: number, syncPreview?: boolean): void;
  onSelection(start: number, end: number): void;
  onUploadFiles(files: readonly File[], start: number, end: number): void;
  onHistory(direction: -1 | 1): void;
  onFormat(format: string): void;
  onError(message: string): void;
}

function clampPoint(value: number, length: number) {
  return Math.max(0, Math.min(length, value));
}

function imageWidth(image: HTMLImageElement) {
  return (
    Number(image.getAttribute('width')) || Math.round(image.getBoundingClientRect().width || image.naturalWidth || 320)
  );
}

function imageGroupIndexes(frame: HTMLElement, images: readonly HTMLImageElement[]) {
  const row = frame.closest<HTMLElement>('.markdown-image-row');
  if (row)
    return Array.from(row.querySelectorAll<HTMLImageElement>('.markdown-image > img[data-md-file]'))
      .map((image) => images.indexOf(image))
      .filter((index) => index >= 0);
  const paragraph = frame.closest<HTMLElement>('p, li, td, th') ?? frame.parentElement;
  if (!paragraph) return [];
  const paragraphs = [paragraph];
  const onlyImages = (element: Element | null) =>
    element?.tagName === 'P' && !element.textContent?.trim() && !!element.querySelector('img[data-md-file]');
  if (onlyImages(paragraph)) {
    let previous = paragraph.previousElementSibling;
    while (previous && onlyImages(previous)) {
      paragraphs.unshift(previous as HTMLElement);
      previous = previous.previousElementSibling;
    }
    let next = paragraph.nextElementSibling;
    while (next && onlyImages(next)) {
      paragraphs.push(next as HTMLElement);
      next = next.nextElementSibling;
    }
  }
  return paragraphs
    .flatMap((element) => Array.from(element.querySelectorAll<HTMLImageElement>('.markdown-image > img[data-md-file]')))
    .map((image) => images.indexOf(image))
    .filter((index) => index >= 0);
}

function markerFor(source: string, start: number, end: number): VisualMarker {
  const id = Math.random().toString(36).slice(2, 12);
  return {
    source,
    start: clampPoint(start, source.length),
    end: clampPoint(end, source.length),
    startToken: `\ue000${id}\ue001`,
    endToken: `\ue002${id}\ue003`,
  };
}

function plainTextFiles(clipboard: DataTransfer | null) {
  if (!clipboard) return [];
  const files = Array.from(clipboard.files);
  return files.length
    ? files
    : Array.from(clipboard.items ?? []).flatMap((item) => {
        const file = item.kind === 'file' ? item.getAsFile() : null;
        return file ? [file] : [];
      });
}

export function MarkdownVisualEditor({
  ref,
  dataAttributes,
  id,
  className,
  editableLabel,
  readonlyLabel,
  placeholder,
  maxLength,
  maxLengthMessage,
  renderSource,
  value,
  media,
  mode,
  editable,
  busy,
  selection,
  restore,
  panelHost,
  onChange,
  onSelection,
  onUploadFiles,
  onHistory,
  onFormat,
  onError,
}: Props) {
  const t = useMessages(markdownMessages);
  const root = useRef<HTMLElement>(null);
  const widthInput = useRef<HTMLInputElement>(null);
  const blocks = useRef(new WeakMap<Element, { source: string; normalized: string }>());
  const resize = useRef<VisualResize | null>(null);
  const previousRestore = useRef(restore.revision);
  const focusAfterMarker = useRef(false);
  const [marker, setMarker] = useState<VisualMarker | null>(null);
  const [image, setImage] = useState<VisualImage | null>(null);
  const [widthDraft, setWidthDraft] = useState('');
  const [resetVersion, setResetVersion] = useState(0);
  const renderedSource = useMemo(() => {
    if (!marker || marker.source !== renderSource) return renderSource;
    return `${renderSource.slice(0, marker.start)}${marker.startToken}${renderSource.slice(
      marker.start,
      marker.end,
    )}${marker.endToken}${renderSource.slice(marker.end)}`;
  }, [marker, renderSource]);

  const preserveBlock = useCallback(
    (element: Element) => {
      const source = blocks.current.get(element);
      return source && normalizeVisualMarkdownBlock(element, media) === source.normalized ? source.source : undefined;
    },
    [media],
  );
  const currentSelection = useCallback(() => {
    const element = root.current;
    return element
      ? serializeVisualMarkdownSelection(element, media, preserveBlock)
      : { value, start: selection[0], end: selection[1] };
  }, [media, preserveBlock, selection, value]);
  const focus = useCallback(() => root.current?.focus({ preventScroll: true }), []);

  useImperativeHandle(ref, () => ({ selection: currentSelection, focus }), [currentSelection, focus]);

  useLayoutEffect(() => {
    if (mode === 'edit') setImage(null);
  }, [mode]);

  useLayoutEffect(() => {
    if (previousRestore.current === restore.revision || mode === 'edit') return;
    previousRestore.current = restore.revision;
    if (!renderSource) return;
    setMarker(markerFor(renderSource, restore.start, restore.end));
    focusAfterMarker.current = true;
  }, [mode, renderSource, restore]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (marker && marker.source === renderSource) {
      const nodes: Text[] = [];
      const walker = element.ownerDocument.createTreeWalker(element, 4);
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const startNode = nodes.find((node) => node.nodeValue?.includes(marker.startToken));
      const endNode = nodes.find((node) => node.nodeValue?.includes(marker.endToken));
      if (startNode && endNode) {
        const startValue = startNode.nodeValue || '';
        const endValue = endNode.nodeValue || '';
        const startOffset = startValue.indexOf(marker.startToken);
        const endOffset = endValue.indexOf(marker.endToken);
        if (startNode === endNode) {
          startNode.nodeValue =
            startValue.slice(0, startOffset) +
            startValue.slice(startOffset + marker.startToken.length, endOffset) +
            startValue.slice(endOffset + marker.endToken.length);
        } else {
          startNode.nodeValue = startValue.replace(marker.startToken, '');
          endNode.nodeValue = endValue.replace(marker.endToken, '');
        }
        const range = element.ownerDocument.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, startNode === endNode ? endOffset - marker.startToken.length : endOffset);
        const selected = element.ownerDocument.getSelection();
        selected?.removeAllRanges();
        selected?.addRange(range);
        if (focusAfterMarker.current) element.focus({ preventScroll: true });
        element.querySelectorAll<HTMLElement>('[data-md-start][data-md-end]').forEach((block) => {
          for (const attribute of ['data-md-start', 'data-md-end']) {
            const offset = Number(block.getAttribute(attribute));
            const startTokenEnd = marker.start + marker.startToken.length;
            const endTokenEnd = marker.end + marker.startToken.length + marker.endToken.length;
            const adjusted =
              offset > endTokenEnd
                ? offset - marker.startToken.length - marker.endToken.length
                : offset > startTokenEnd
                  ? offset - marker.startToken.length
                  : offset;
            block.setAttribute(attribute, String(adjusted));
          }
        });
      } else {
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        const selected = element.ownerDocument.getSelection();
        selected?.removeAllRanges();
        selected?.addRange(range);
        if (focusAfterMarker.current) element.focus({ preventScroll: true });
      }
      focusAfterMarker.current = false;
      setMarker(null);
    }
    blocks.current = new WeakMap();
    element.querySelectorAll<HTMLElement>('[data-md-start][data-md-end]').forEach((block) => {
      const start = Number(block.dataset.mdStart);
      const end = Number(block.dataset.mdEnd);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return;
      blocks.current.set(block, {
        source: renderSource.slice(start, end),
        normalized: normalizeVisualMarkdownBlock(block, media),
      });
    });
  }, [marker, media, renderSource]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !image) return;
    const current = element.querySelectorAll<HTMLImageElement>('.markdown-image > img[data-md-file]')[image.index];
    if (!current || current.getAttribute('data-md-file') !== image.reference) {
      setImage(null);
      setWidthDraft('');
    }
  }, [image, mode, renderSource]);

  const getImages = () =>
    Array.from(root.current?.querySelectorAll<HTMLImageElement>('.markdown-image > img[data-md-file]') ?? []);
  const imageInFrame = (frame: HTMLElement | null) => {
    const selected = frame?.querySelector<HTMLImageElement>('img[data-md-file]');
    if (!frame || !selected) return null;
    const images = getImages();
    const index = images.indexOf(selected);
    if (index < 0) return null;
    return {
      index,
      reference: selected.getAttribute('data-md-file') || '',
      groupIndexes: imageGroupIndexes(frame, images),
      width: imageWidth(selected),
      widthAttribute: Number(selected.getAttribute('width')) || 0,
      columns: Number(selected.getAttribute('data-md-columns')) || 1,
    };
  };
  const selectImage = (target: Element) => {
    const frame = target.closest<HTMLElement>('[data-md-image]');
    if (!frame || !editable || busy || mode === 'edit') return;
    const current = imageInFrame(frame);
    if (!current) return;
    setImage(current);
    setWidthDraft(String(current.width));
    frame.focus({ preventScroll: true });
  };
  const applyImageChange = (change: { width?: number; columns?: number }) => {
    if (!image || !editable || busy) return;
    if (
      change.width !== undefined &&
      (!Number.isInteger(change.width) || (change.width !== 0 && (change.width < 80 || change.width > 1200)))
    ) {
      onError(t.widthRange);
      setWidthDraft(String(image.width));
      widthInput.current?.focus();
      return;
    }
    const updated = updateVisualMarkdownImages(value, media, image.index, image.groupIndexes, change);
    const widthAttribute = change.width === undefined ? image.widthAttribute : change.width;
    const nextWidth =
      change.width === undefined ? image.width : change.width || getImages()[image.index]?.naturalWidth || image.width;
    const nextImage = {
      ...image,
      width: nextWidth,
      widthAttribute,
      columns: change.columns ?? image.columns,
    };
    setImage(nextImage);
    setWidthDraft(String(nextWidth));
    if (updated !== value) onChange(updated, selection[0], selection[1], true);
  };

  const cancelResize = useCallback(() => {
    const active = resize.current;
    if (!active) return;
    resize.current = null;
    root.current?.classList.remove('is-resizing-image');
    const current = root.current?.querySelectorAll<HTMLImageElement>('.markdown-image > img[data-md-file]')[
      active.image
    ];
    if (current) {
      const frame = current.closest<HTMLElement>('[data-md-image]');
      if (active.widthAttribute) current.setAttribute('width', String(active.widthAttribute));
      else current.removeAttribute('width');
      if (frame) frame.style.width = active.widthAttribute ? `${active.widthAttribute}px` : '';
    }
    setImage((value) =>
      value?.index === active.image
        ? { ...value, width: active.startWidth, widthAttribute: active.widthAttribute }
        : value,
    );
    setWidthDraft(String(active.startWidth));
  }, []);

  const pointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest<HTMLButtonElement>('[data-md-image-resize]');
    const frame = handle?.closest<HTMLElement>('[data-md-image]');
    const selected = frame?.querySelector<HTMLImageElement>('img[data-md-file]');
    if (!handle || !frame || !selected || !editable || busy) return;
    event.preventDefault();
    selectImage(frame);
    root.current?.classList.add('is-resizing-image');
    const images = getImages();
    const index = images.indexOf(selected);
    if (index < 0) return;
    const groupIndexes = imageGroupIndexes(frame, images);
    const startWidth = imageWidth(selected);
    resize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      width: startWidth,
      widthAttribute: Number(selected.getAttribute('width')) || 0,
      image: index,
      groupIndexes,
    };
    handle.setPointerCapture?.(event.pointerId);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const active = resize.current;
    if (!active || active.pointerId !== event.pointerId || !editable || busy) return;
    event.preventDefault();
    active.width = Math.max(80, Math.min(1200, Math.round(active.startWidth + event.clientX - active.startX)));
    const selected = getImages()[active.image];
    if (!selected) return;
    selected.setAttribute('width', String(active.width));
    const frame = selected.closest<HTMLElement>('[data-md-image]');
    if (frame) frame.style.width = `${active.width}px`;
    frame?.querySelector('[data-md-image-resize]')?.setAttribute('aria-valuenow', String(active.width));
    setImage((value) =>
      value?.index === active.image ? { ...value, width: active.width, widthAttribute: active.width } : value,
    );
    setWidthDraft(String(active.width));
  };

  const pointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const active = resize.current;
    if (!active || active.pointerId !== event.pointerId) return;
    resize.current = null;
    root.current?.classList.remove('is-resizing-image');
    const updated = updateVisualMarkdownImages(value, media, active.image, active.groupIndexes, {
      width: active.width,
    });
    if (updated !== value) {
      onChange(updated, selection[0], selection[1], true);
      requestAnimationFrame(() => widthInput.current?.focus());
    }
  };

  const commitSelection = () => {
    if (!editable || busy || mode === 'edit') return;
    const result = currentSelection();
    onSelection(result.start, result.end);
  };
  const insertPlainText = (text: string) => {
    const element = root.current;
    const selected = element?.ownerDocument.getSelection();
    if (!element || !selected) return;
    const range =
      selected.rangeCount && element.contains(selected.anchorNode)
        ? selected.getRangeAt(0)
        : element.ownerDocument.createRange();
    if (!selected.rangeCount || !element.contains(selected.anchorNode)) {
      range.selectNodeContents(element);
      range.collapse(false);
    }
    range.deleteContents();
    const node = element.ownerDocument.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selected.removeAllRanges();
    selected.addRange(range);
    commitInput();
  };
  const commitInput = () => {
    if (!editable || busy || mode === 'edit') return;
    const result = currentSelection();
    if (result.value.length > maxLength) {
      onError(maxLengthMessage);
      focusAfterMarker.current = true;
      setMarker(markerFor(renderSource, result.start, result.end));
      setResetVersion((version) => version + 1);
      return;
    }
    onChange(result.value, result.start, result.end, false);
  };
  const paste = (event: ReactClipboardEvent<HTMLElement>) => {
    if (!editable || busy || mode === 'edit') {
      event.preventDefault();
      return;
    }
    const files = plainTextFiles(event.clipboardData);
    const point = currentSelection();
    if (files.length) {
      event.preventDefault();
      onUploadFiles(files, point.start, point.end);
      return;
    }
    const text = event.clipboardData.getData('text/plain');
    if (text) {
      event.preventDefault();
      insertPlainText(text);
    }
  };
  const drop = (event: ReactDragEvent<HTMLElement>) => {
    if (!editable || busy || mode === 'edit') return;
    event.preventDefault();
    const files = plainTextFiles(event.dataTransfer);
    const point = currentSelection();
    if (files.length) onUploadFiles(files, point.start, point.end);
    else {
      const text = event.dataTransfer.getData('text/plain');
      if (text) insertPlainText(text);
    }
  };
  const keyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!editable || busy || mode === 'edit' || event.nativeEvent.isComposing) return;
    const target = event.target instanceof Element ? event.target : null;
    const frame = target?.closest<HTMLElement>('[data-md-image]');
    const handle = target?.closest<HTMLElement>('[data-md-image-resize]');
    if (handle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (frame) selectImage(frame);
      const current = imageInFrame(frame ?? null);
      if (!current) return;
      const delta = (event.shiftKey ? 64 : 16) * (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
      const next =
        event.key === 'Home' ? 80 : event.key === 'End' ? 1200 : Math.max(80, Math.min(1200, current.width + delta));
      const updated = updateVisualMarkdownImages(value, media, current.index, current.groupIndexes, { width: next });
      setImage({ ...current, width: next, widthAttribute: next });
      setWidthDraft(String(next));
      if (updated !== value) {
        onChange(updated, selection[0], selection[1], true);
        requestAnimationFrame(() => widthInput.current?.focus());
      }
      return;
    }
    if (frame && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      selectImage(frame);
      requestAnimationFrame(() => widthInput.current?.focus());
      return;
    }
    if (frame && ['Backspace', 'Delete'].includes(event.key)) {
      event.preventDefault();
      frame.remove();
      setImage(null);
      setWidthDraft('');
      commitInput();
      requestAnimationFrame(focus);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (value.length > 0) root.current?.closest('form')?.requestSubmit();
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      ['b', 'i', 'k'].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      onFormat(({ b: 'bold', i: 'italic', k: 'link' } as const)[event.key.toLowerCase() as 'b' | 'i' | 'k']);
    } else if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      onHistory(event.key.toLowerCase() === 'y' || event.shiftKey ? 1 : -1);
    }
  };

  useEffect(() => {
    if (!editable || busy || mode === 'edit') {
      cancelResize();
      setImage(null);
      setWidthDraft('');
    }
  }, [busy, cancelResize, editable, mode]);
  useEffect(
    () => () => {
      resize.current = null;
    },
    [],
  );

  const imagePanel =
    panelHost && image && editable && !busy && mode !== 'edit'
      ? createPortal(
          <div className="md-editor-image-settings" role="group" aria-label={t.imageSettings}>
            <strong>{t.image}</strong>
            <label>
              {t.width}{' '}
              <input
                ref={widthInput}
                type="number"
                min={80}
                max={1200}
                step={1}
                data-md-image-width
                aria-label={t.imageWidth}
                value={widthDraft}
                onChange={(event) => setWidthDraft(event.currentTarget.value)}
                onBlur={() => applyImageChange({ width: widthDraft === '' ? Number.NaN : Number(widthDraft) })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyImageChange({ width: widthDraft === '' ? Number.NaN : Number(widthDraft) });
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setWidthDraft(String(image.width));
                    focus();
                  }
                }}
              />{' '}
              px
            </label>
            <label>
              {t.layout}{' '}
              <Select
                data-md-image-layout
                aria-label={t.perRowLabel}
                value={image.columns}
                onChange={(event) => applyImageChange({ columns: Number(event.currentTarget.value) })}
              >
                {[1, 2, 3, 4].map((columns) => (
                  <option key={columns} value={columns}>
                    {t.perRow(columns)}
                  </option>
                ))}
              </Select>
            </label>
            <button type="button" data-md-image-reset onClick={() => applyImageChange({ width: 0 })}>
              {t.originalSize}
            </button>
            <button
              type="button"
              data-md-image-close
              aria-label={t.closeSettings}
              onClick={() => {
                setImage(null);
                setWidthDraft('');
                focus();
              }}
            >
              <Icon className="xyz-icon" name="x" aria-hidden="true" />
            </button>
          </div>,
          panelHost,
          'todo-project-image-settings',
        )
      : null;

  return (
    <>
      <MarkdownView
        ref={root}
        key={`${resetVersion}:${renderSource}`}
        as="article"
        id={id}
        className={className}
        {...dataAttributes}
        tabIndex={0}
        aria-label={editable ? editableLabel : readonlyLabel}
        aria-multiline={editable || undefined}
        aria-readonly={!editable || busy || undefined}
        aria-busy={busy || undefined}
        data-placeholder={placeholder}
        role={editable ? 'textbox' : 'document'}
        contentEditable={editable && !busy && mode !== 'edit'}
        hidden={mode === 'edit'}
        value={renderedSource}
        media={media}
        editable={editable}
        visualEditable={editable && !busy && mode !== 'edit'}
        after={!editable && !value ? <p className="md-editor-empty">{t.empty}</p> : undefined}
        onInput={commitInput}
        onBeforeInput={(event) => {
          const inputType = (event.nativeEvent as InputEvent).inputType;
          if (inputType === 'historyUndo' || inputType === 'historyRedo') {
            event.preventDefault();
            onHistory(inputType === 'historyUndo' ? -1 : 1);
          }
        }}
        onPaste={paste}
        onDrop={drop}
        onDragOver={(event) => {
          if (editable && !busy && mode !== 'edit') event.preventDefault();
        }}
        onClick={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (editable && target?.closest('a')) event.preventDefault();
          const frame = target?.closest('[data-md-image]');
          if (frame) selectImage(frame);
          else {
            setImage(null);
            setWidthDraft('');
          }
        }}
        onKeyDown={keyDown}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={cancelResize}
        onKeyUp={commitSelection}
        onMouseUp={commitSelection}
        onFocus={commitSelection}
        onBlur={commitSelection}
      />
      {imagePanel}
    </>
  );
}
