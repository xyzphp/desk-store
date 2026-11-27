import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button, EmptyState, Icon, IconButton, SearchField, Select, WindowDialog, type WindowGeometry } from '@xyzos/desk-ui';
import { AppImage } from '../sdk/media';
import './file-picker.css';
import { filesMessages } from './locale';
import { useMessages } from '@xyzos/desk-ui';

export interface FilePickerItem {
  id: string;
  name: string;
  /** 图片文件编号（沙箱内通过 AppImage 加载）；或外部缩略图地址。 */
  fileId?: number;
  thumbnail?: string;
  /** 已经被当前内容使用的标记，如“已添加”。 */
  mark?: string;
  disabled?: boolean;
  /** 为该文件显示的第二个动作，如图片的“设为封面”。 */
  secondary?: boolean;
}

export interface FilePickerProps {
  open: boolean;
  title?: string;
  items: readonly FilePickerItem[];
  loading?: boolean;
  busy?: boolean;
  /** 上传目标存储；只有多个存储时才显示选择框。 */
  providers?: readonly { id: number; name: string }[];
  providerId?: number;
  onProviderChange?(id: number): void;
  accept?: string;
  multiple?: boolean;
  onPick(id: string): void;
  secondaryLabel?: string;
  onSecondary?(id: string): void;
  onUpload(files: File[]): void;
  onPickPlatform?(): void;
  pickPlatformLabel?: string;
  onRefresh?(): void;
  onClose(): void;
}

/** 与系统应用窗口一致的居中窗口：标题栏沿用窗口外壳（红黄绿按钮、居中标题），可拖动与缩放。 */
function initialGeometry(): WindowGeometry {
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  const width = Math.max(1, Math.min(760, viewportWidth - 40));
  const height = Math.max(1, Math.min(600, viewportHeight - 60));
  return { x: (viewportWidth - width) / 2, y: (viewportHeight - height) / 2, width, height };
}

/**
 * 统一的“选择文件”窗口：先从文件管理里已有的文件中挑选（可搜索），
 * 没有合适的再点底部“上传新文件”调起系统的文件选择器。
 */
export function FilePickerDialog({
  open,
  title: titleOverride,
  items,
  loading = false,
  busy = false,
  providers = [],
  providerId = 0,
  onProviderChange,
  accept,
  multiple = true,
  onPick,
  secondaryLabel,
  onSecondary,
  onUpload,
  onPickPlatform,
  pickPlatformLabel,
  onRefresh,
  onClose,
}: FilePickerProps) {
  const t = useMessages(filesMessages);
  const title = titleOverride ?? t.pickTitle;
  const [query, setQuery] = useState('');
  const [geometry, setGeometry] = useState<WindowGeometry>(initialGeometry);
  const [maximized, setMaximized] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setMaximized(false);
    setGeometry(initialGeometry());
  }, [open]);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? items.filter((item) => item.name.toLocaleLowerCase().includes(term)) : items;
  }, [items, query]);
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (selected.length) onUpload(selected);
  };
  return (
    <WindowDialog
      open={open}
      title={title}
      className="desk-file-picker"
      geometry={geometry}
      onGeometryChange={setGeometry}
      maximized={maximized}
      onToggleMaximize={() => setMaximized((value) => !value)}
      titlebarControls={['close', 'maximize']}
      scrollable={false}
      minWidth={420}
      minHeight={320}
      initialFocus={search}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <div className="desk-file-picker-body">
        <div className="desk-file-picker-tools">
          <SearchField
            ref={search}
            className="desk-file-picker-search"
            placeholder={t.search}
            label={t.search}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
          <div className="desk-file-picker-actions">
            {providers.length > 1 && (
              <Select
                aria-label={t.uploadTarget}
                value={providerId}
                disabled={busy}
                onChange={(event) => onProviderChange?.(Number(event.currentTarget.value))}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </Select>
            )}
            {onPickPlatform && (
              <Button icon="folder-open" disabled={busy} onClick={onPickPlatform}>
                {pickPlatformLabel || '从文件管理选择'}
              </Button>
            )}
            <Button variant="primary" icon="upload" disabled={busy} onClick={() => input.current?.click()}>
              {t.uploadNew}
            </Button>
            {onRefresh && (
              <IconButton icon="rotate-ccw" label={t.refresh} disabled={busy || loading} onClick={onRefresh} />
            )}
            <input
              ref={input}
              type="file"
              hidden
              multiple={multiple}
              accept={accept}
              aria-label={t.uploadNew}
              onChange={change}
            />
          </div>
        </div>
        <div className="desk-file-picker-list ds-scrollable" role="list" aria-label={t.existing} aria-busy={loading}>
          {visible.map((item) => (
            <div key={item.id} role="listitem" className="desk-file-picker-cell">
              <button
                type="button"
                className="desk-file-picker-item"
                aria-label={item.name}
                title={item.name}
                disabled={busy || item.disabled}
                onClick={() => onPick(item.id)}
              >
                <span className="desk-file-picker-thumb">
                  {item.fileId ? (
                    <AppImage fileId={item.fileId} alt="" loading="lazy" />
                  ) : item.thumbnail ? (
                    <img src={item.thumbnail} alt="" loading="lazy" />
                  ) : (
                    <Icon name="file" />
                  )}
                </span>
                <span className="desk-file-picker-caption">
                  <span>{item.name}</span>
                  {item.mark && <small>{item.mark}</small>}
                </span>
              </button>
              {item.secondary && secondaryLabel && onSecondary && (
                <Button size="sm" disabled={busy || item.disabled} onClick={() => onSecondary(item.id)}>
                  {secondaryLabel}
                </Button>
              )}
            </div>
          ))}
        </div>
        {!visible.length && (
          <EmptyState role="status">{loading ? t.loading : items.length ? t.noMatch : t.empty}</EmptyState>
        )}
        {!!visible.length && <p className="desk-file-picker-hint">{t.hint}</p>}
      </div>
    </WindowDialog>
  );
}
