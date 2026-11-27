declare module '@xyzos/desk-ui' {
  import type { ComponentProps, ElementType, ReactNode, Ref, RefObject } from 'react';

  export type ThemeChoice = 'light' | 'dark' | 'auto';
  export type IconName = string;
  export type AIResultState = 'idle' | 'generating' | 'ready' | 'error';
  export type MessageCatalog<T> = Record<string, T>;

  export interface WindowGeometry {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export interface MarkdownMedia {
    url: string;
    image: boolean;
  }

  export interface ImageCropResult {
    blob: Blob;
    width: number;
    height: number;
    mimeType: string;
  }

  export interface LocaleDefinition {
    code: string;
    labels: {
      markdownView: {
        task: { done: string; pending: string };
        image: string;
        imageHint: (alt: string) => string;
        resizeImage: string;
      };
    };
  }

  export const locales: readonly LocaleDefinition[];
  export function defineMessages<T>(
    defaultLocale: string,
    defaults: T,
    others?: Record<string, T>,
  ): MessageCatalog<T>;
  export function pickMessages<T>(catalog: MessageCatalog<T>, locale: string): T;
  export function useMessages<T>(catalog: MessageCatalog<T>): T;
  export function useLocale(): string;
  export function useLabels(section: 'markdownView'): LocaleDefinition['labels']['markdownView'];
  export function cx(...parts: Array<string | false | null | undefined>): string;

  export function ConfigProvider(props: { locale?: string; children?: ReactNode }): ReactNode;

  export function Icon(props: {
    name: IconName;
    className?: string;
    strokeWidth?: number;
    'aria-hidden'?: boolean | 'true' | 'false';
  }): ReactNode;

  export function Button(
    props: Omit<ComponentProps<'button'>, 'ref'> & {
      ref?: Ref<HTMLButtonElement>;
      variant?: 'default' | 'primary' | 'danger' | 'quiet';
      size?: 'sm' | 'md' | 'lg';
      icon?: IconName;
      pressed?: boolean;
    },
  ): ReactNode;

  export function IconButton(
    props: Omit<ComponentProps<'button'>, 'children'> & {
      icon: IconName;
      label: string;
    },
  ): ReactNode;

  export function Select(props: ComponentProps<'select'>): ReactNode;
  export function Textarea(props: ComponentProps<'textarea'>): ReactNode;
  export function Checkbox(
    props: Omit<ComponentProps<'input'>, 'type'> & {
      children?: ReactNode;
    },
  ): ReactNode;
  export function HelpTip(props: { text: string; className?: string }): ReactNode;
  export function EmptyState(props: { role?: string; children?: ReactNode; className?: string }): ReactNode;

  export function SearchField(
    props: Omit<ComponentProps<'input'>, 'ref'> & {
      ref?: Ref<HTMLInputElement>;
      label?: string;
    },
  ): ReactNode;

  export function NavSidebar(
    props: {
      as?: ElementType;
      title?: ReactNode;
      footer?: ReactNode;
      children?: ReactNode;
    } & ComponentProps<'aside'>,
  ): ReactNode;

  export function NavItem(
    props: ComponentProps<'button'> & {
      icon?: IconName;
      current?: boolean;
    },
  ): ReactNode;

  export function WindowTitlebar(
    props: {
      as?: ElementType;
      title?: ReactNode;
      controls?: ReadonlyArray<'close' | 'minimize' | 'maximize'>;
      onClose?: () => void;
    } & ComponentProps<'header'>,
  ): ReactNode;

  export function WindowDialog(props: {
    open: boolean;
    title: string;
    className?: string;
    geometry: WindowGeometry;
    onGeometryChange: (next: WindowGeometry) => void;
    maximized?: boolean;
    onToggleMaximize?: () => void;
    titlebarControls?: ReadonlyArray<'close' | 'minimize' | 'maximize'>;
    scrollable?: boolean;
    minWidth?: number;
    minHeight?: number;
    initialFocus?: RefObject<HTMLElement | null>;
    onCancel?: () => void;
    children?: ReactNode;
  }): ReactNode;

  export function AnchorPopover(
    props: {
      as?: ElementType;
      open: boolean;
      anchor: RefObject<HTMLElement | null>;
      placement?: string;
      gap?: number;
      manual?: boolean;
      dismissOnFocusOutside?: boolean;
      onClose?: () => void;
      children?: ReactNode;
      ref?: Ref<HTMLDivElement>;
    } & Omit<ComponentProps<'div'>, 'ref'>,
  ): ReactNode;

  export function ContextMenu(props: {
    x: number;
    y: number;
    onClose: () => void;
    'aria-label'?: string;
    children?: ReactNode;
  }): ReactNode;

  export function ContextMenuItem(
    props: ComponentProps<'button'> & {
      icon?: IconName;
    },
  ): ReactNode;

  export function ContextMenuDivider(): ReactNode;
  export function Field(props: { label: string; children?: ReactNode }): ReactNode;

  export function ImageCropper(props: {
    nativeStructure?: boolean;
    label?: string;
    source: Blob;
    outputSize: { width: number; height: number };
    mimeType?: string;
    quality?: number;
    disabled?: boolean;
    onCancel: () => void;
    onConfirm: (result: ImageCropResult) => void;
    labels?: {
      confirm?: string;
      cancel?: string;
      dimensions?: (width: number, height: number) => string;
    };
  }): ReactNode;

  export function MarkdownView(
    props: Omit<ComponentProps<'article'>, 'children' | 'ref'> & {
      ref?: Ref<HTMLElement>;
      as?: 'article' | 'div';
      value: string;
      media?: Readonly<Record<string, MarkdownMedia>>;
      editable?: boolean;
      visualEditable?: boolean;
      after?: ReactNode;
    },
  ): ReactNode;
}
