import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { aiMessages } from './locale';
import { useMessages } from '@xyzos/desk-ui';

type ResizeDirection = 'e' | 's' | 'w' | 'se';
interface Gesture {
  kind: 'drag' | 'resize';
  direction?: ResizeDirection;
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
}
interface Geometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const leftEdge = 8;
const topEdge = 40;

/**
 * 原站快捷工具浮窗的拖动与缩放：标题栏指针 / 方向键移动，边缘与右下角缩放。
 * 位置只保存在本组件状态；打开面板时由锚点定位，拖动 / 缩放后改为固定（manual）。
 */
export function useAIPanelGesture() {
  const t = useMessages(aiMessages);
  const panel = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [geometry, setGeometry] = useState<Partial<Geometry>>({});

  const begin = (event: ReactPointerEvent<HTMLElement>, kind: 'drag' | 'resize', direction?: ResizeDirection) => {
    const element = panel.current;
    if (!element || event.button !== 0 || event.isPrimary === false) return;
    if (kind === 'drag' && (event.target as HTMLElement).closest('button')) return;
    const rect = element.getBoundingClientRect();
    event.preventDefault();
    gesture.current = {
      kind,
      direction,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    const rightEdge = window.innerWidth - 8;
    const bottomEdge = window.innerHeight - 8;
    if (current.kind === 'drag') {
      setGeometry((previous) => ({
        ...previous,
        left: Math.max(leftEdge, Math.min(current.left + dx, rightEdge - current.width)),
        top: Math.max(topEdge, Math.min(current.top + dy, bottomEdge - current.height)),
      }));
      return;
    }
    let { left } = current;
    const { top } = current;
    let width = current.width;
    let height = current.height;
    const direction = current.direction ?? 'se';
    if (direction === 'w') {
      const available = Math.max(0, current.left + current.width - leftEdge);
      width = Math.max(Math.min(360, available), Math.min(current.width - dx, available));
      left = current.left + current.width - width;
    } else if (direction.includes('e')) {
      width = Math.min(Math.max(0, rightEdge - current.left), Math.max(360, current.width + dx));
    }
    if (direction.includes('s')) {
      height = Math.min(Math.max(0, bottomEdge - current.top), Math.max(240, current.height + dy));
    }
    setGeometry({ left, top, width, height });
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (gesture.current?.pointerId === event.pointerId) gesture.current = null;
  };
  const moveWithKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (!arrows.includes(event.key) || (event.target as HTMLElement).closest('button')) return;
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    const maxLeft = Math.max(leftEdge, window.innerWidth - 8 - rect.width);
    const maxTop = Math.max(topEdge, window.innerHeight - 8 - rect.height);
    setGeometry((previous) => ({
      ...previous,
      left: Math.max(
        leftEdge,
        Math.min(rect.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), maxLeft),
      ),
      top: Math.max(
        topEdge,
        Math.min(rect.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), maxTop),
      ),
    }));
  };
  const resizeWithKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (!arrows.includes(event.key)) return;
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    const maxWidth = Math.max(0, window.innerWidth - 8 - rect.left);
    const maxHeight = Math.max(0, window.innerHeight - 8 - rect.top);
    setGeometry({
      left: rect.left,
      top: rect.top,
      width: Math.max(
        Math.min(360, maxWidth),
        Math.min(maxWidth, rect.width + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)),
      ),
      height: Math.max(
        Math.min(240, maxHeight),
        Math.min(maxHeight, rect.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)),
      ),
    });
  };

  return {
    /** 传给 AnchorPopover 的 ref / style / manual 与指针事件。 */
    panelProps: {
      ref: panel,
      style: geometry,
      manual: geometry.left !== undefined,
      onPointerMove: move,
      onPointerUp: end,
      onLostPointerCapture: end,
    },
    /** 标题栏作为拖动手柄。 */
    handleProps: {
      tabIndex: 0,
      'aria-label': t.movePanel,
      'data-ai-drag-handle': true,
      'data-initial-focus-skip': true,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => begin(event, 'drag'),
      onKeyDown: moveWithKeys,
    },
    begin,
    resizeWithKeys,
  };
}

/** 左、右、下边缘和右下角缩放手柄；仅右下角可键盘聚焦。 */
export function AIPanelResizers({ gesture }: { gesture: ReturnType<typeof useAIPanelGesture> }) {
  const t = useMessages(aiMessages);
  return (
    <>
      {(['e', 's', 'w', 'se'] as const).map((direction) => (
        <div
          key={direction}
          className={`resizer r-${direction} ds-resizer ds-resizer--${direction}`}
          data-ai-resize={direction}
          tabIndex={direction === 'se' ? 0 : undefined}
          role={direction === 'se' ? 'button' : undefined}
          aria-label={direction === 'se' ? t.resizePanel : undefined}
          aria-hidden={direction === 'se' ? undefined : true}
          title={direction === 'se' ? t.resizeHint : undefined}
          onPointerDown={(event) => gesture.begin(event, 'resize', direction)}
          onKeyDown={direction === 'se' ? gesture.resizeWithKeys : undefined}
        />
      ))}
    </>
  );
}
