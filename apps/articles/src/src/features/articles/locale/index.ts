import { defineMessages } from '@xyzos/desk-ui';
import { currentMessages } from '../../../shared/i18n/current';
import { enUS } from './en-US';
import { zhCN } from './zh-CN';

export const articleMessages = defineMessages('zh-CN', zhCN, { 'en-US': enUS });
export type ArticleMessages = typeof zhCN;

/** 非 React 代码在产生文案的那一刻取当前语言的字典；不要缓存返回值。 */
export const articleText = () => currentMessages(articleMessages);
