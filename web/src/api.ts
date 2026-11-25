// 商店静态数据（api/v1）的类型与读取。字段与 pkg/appspec/catalog.go 保持一致。

export interface PublicKey {
  id: string;
  algorithm: string;
  key: string;
}

export interface StoreInfo {
  schema: number;
  id: string;
  name: string;
  description: string;
  homepage?: string;
  access: 'public' | 'token';
  formats: number[];
  keys: PublicKey[];
}

export interface IndexEntry {
  slug: string;
  name: string;
  summary: string;
  category: string;
  tags: string[];
  icon: string;
  latestVersion: string;
  pricing: Pricing;
  capabilities: string[];
  withdrawn: boolean;
  updatedAt: string;
}

export interface StoreIndex {
  schema: number;
  generatedAt: string;
  apps: IndexEntry[];
}

export type Pricing = 'free' | 'freemium' | 'subscription';

export interface ProxySummary {
  key: string;
  title: string;
  upstream: string;
  baseUrlEditable: boolean;
  authType: string;
  needsCredential: boolean;
  methods: string[];
  paths: string[];
  passQuery: boolean;
}

export interface PermissionSummary {
  entry: 'entry' | 'gateway_page';
  gatewayApi: string[];
  proxies: ProxySummary[];
  desktopWidget: boolean;
  capabilities: string[];
}

export interface AppVersion {
  version: string;
  format: number;
  sha256: string;
  size: number;
  url: string;
  publishedAt: string;
  yanked: boolean;
  changelog?: string;
  permissions: PermissionSummary;
  signature?: { keyId: string; value: string };
}

export interface AppDetail {
  schema: number;
  slug: string;
  name: string;
  summary: string;
  description: string;
  category: string;
  tags: string[];
  authors: { name: string; url?: string }[];
  license: string;
  homepage?: string;
  repository?: string;
  source?: string;
  pricing: Pricing;
  pricingUrl?: string;
  icon: string;
  screenshots: string[];
  withdrawn: boolean;
  latestVersion: string;
  versions: AppVersion[];
}

const apiBase = new URL('api/v1/', document.baseURI);

/** 把数据中的相对地址解析为绝对地址。 */
export function resolveAsset(value: string) {
  return value ? new URL(value, apiBase).href : '';
}

/** 商店地址：在 XYZOS 中添加商店源时填写。 */
export function storeAddress() {
  return new URL('./', document.baseURI).href;
}

async function load<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, apiBase), { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

const cache = new Map<string, Promise<unknown>>();

function cached<T>(path: string): Promise<T> {
  let request = cache.get(path) as Promise<T> | undefined;
  if (!request) {
    request = load<T>(path);
    request.catch(() => cache.delete(path));
    cache.set(path, request);
  }
  return request;
}

export const fetchStore = () => cached<StoreInfo>('store.json');
export const fetchIndex = () => cached<StoreIndex>('index.json');
export const fetchApp = (slug: string) => cached<AppDetail>(`apps/${encodeURIComponent(slug)}.json`);

export const categoryLabels: Record<string, string> = {
  productivity: '效率',
  tools: '工具',
  monitoring: '监控',
  data: '数据',
  communication: '沟通',
  developer: '开发',
  other: '其他',
};

export const pricingLabels: Record<Pricing, string> = {
  free: '免费',
  freemium: '基础免费',
  subscription: '需订阅服务',
};

export const capabilityLabels: Record<string, string> = {
  gateway_page: '上游页面',
  gateway_api: '调用系统接口',
  desktop_widget: '桌面卡片',
  widget: '数据卡片',
  'widget.account_selector': '卡片账号切换',
  window: '自定义窗口尺寸',
};

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN');
}
