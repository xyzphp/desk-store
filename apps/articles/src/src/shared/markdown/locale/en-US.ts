import type { zhCN } from './zh-CN';

export const enUS: typeof zhCN = {
  widthRange: 'Image width must be between 80 and 1200 pixels',
  imageSettings: 'Image settings',
  image: 'Image',
  imageWidth: 'Image width',
  perRowLabel: 'Images per row',
  originalSize: 'Original size',
  closeSettings: 'Collapse image settings',
  empty: 'No content yet.',
  width: 'Width',
  layout: 'Layout',
  perRow: (count) => `${count} per row`,
};
