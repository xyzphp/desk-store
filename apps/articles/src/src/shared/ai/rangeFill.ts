import type { CSSProperties } from 'react';

/** 原站 `workspace-range` 的已填充比例：由当前档位在 0..max 中的位置算出 `--range-fill`。 */
export function rangeFill(index: number, max: number): CSSProperties {
  const percent = max > 0 ? (Math.min(Math.max(index, 0), max) / max) * 100 : 0;
  return { '--range-fill': `${percent}%` } as CSSProperties;
}
