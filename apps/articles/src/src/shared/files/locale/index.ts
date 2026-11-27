import { defineMessages } from '@xyzos/desk-ui';
import { currentMessages } from '../../i18n/current';
import { enUS } from './en-US';
import { zhCN } from './zh-CN';

export const filesMessages = defineMessages('zh-CN', zhCN, { 'en-US': enUS });
export type FilesMessages = typeof zhCN;

/** 非 React 代码在产生文案的那一刻取当前语言的字典；不要缓存返回值。组件里用 useMessages(filesMessages)。 */
export const filesText = () => currentMessages(filesMessages);
