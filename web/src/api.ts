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
  access: "public" | "token";
  formats: number[];
  keys: PublicKey[];
  /** 安全通告文件的相对地址；不发布通告的商店没有这个字段。 */
  advisories?: string;
}

/** 应用组件，见 docs/spec/01-package-v2.md。 */
export type Component = "ui" | "backend" | "mcp" | "skills";

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
  components?: Component[];
  requires?: { platform: number };
}

export interface StoreIndex {
  schema: number;
  generatedAt: string;
  apps: IndexEntry[];
}

export type Pricing = "free" | "freemium" | "subscription";

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

export interface ToolSummary {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  destructive: boolean;
  kind: "backend" | "declarative" | "remote";
}

export interface SkillFile {
  path: string;
  size: number;
  content?: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  tools?: string[];
  files?: SkillFile[];
}

export interface RouteAuditSummary {
  mode?: "write" | "all" | "off";
  action?: string;
  label?: string;
}

export interface PermissionSummary {
  entry: "entry" | "gateway_page" | "none";
  gatewayApi: string[];
  proxies: ProxySummary[];
  desktopWidget: boolean;
  capabilities: string[];
  // 格式 2，见 docs/spec/03-catalog.md 第 4 节。
  access?: {
    permissions: { name: string; title: string }[];
    defaultGrant: string;
  };
  surfaces?: {
    standalone: boolean;
    public?: { alias?: string; session: string };
  };
  backend?: {
    routes: {
      path: string;
      methods: string[];
      visibility: string;
      audit?: RouteAuditSummary;
    }[];
    storage: { shared: boolean; public: boolean; account: boolean };
    http: string[];
    hooks: string[];
    schedules: string[];
    config: { key: string; title: string; secret: boolean }[];
  };
  platform?: { uses: string[]; provides: string[] };
  mcp?: {
    tools: ToolSummary[];
    resources: { uri: string; title: string }[];
    prompts: { name: string; title: string }[];
    remote?: { proxy: string; pinnedTools: string[] };
  };
  skills?: SkillSummary[];
}

export interface Advisory {
  id: string;
  slug: string;
  versions: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  fixedIn?: string;
  action: "update" | "disable";
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
  components?: Component[];
  requires?: { platform: number };
  capabilities?: string[];
  migrations?: Record<string, { id: string; sha256: string }[]>;
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

const apiBase = new URL("api/v1/", document.baseURI);

/** 把数据中的相对地址解析为绝对地址。 */
export function resolveAsset(value: string) {
  return value ? new URL(value, apiBase).href : "";
}

/** 商店地址：在 XYZOS 中添加商店源时填写。 */
export function storeAddress() {
  return new URL("./", document.baseURI).href;
}

async function load<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, apiBase), {
    headers: { Accept: "application/json" },
  });
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

export const fetchStore = () => cached<StoreInfo>("store.json");
export const fetchIndex = () => cached<StoreIndex>("index.json");
export const fetchApp = (slug: string) =>
  cached<AppDetail>(`apps/${encodeURIComponent(slug)}.json`);

/** 读取安全通告；商店不发布通告时返回空列表。网站只做展示，签名由目标系统校验。 */
export async function fetchAdvisories(): Promise<Advisory[]> {
  const info = await fetchStore();
  if (!info.advisories) return [];
  const data = await cached<{ advisories?: Advisory[] }>(info.advisories);
  return data.advisories ?? [];
}

export type AppType = "app" | "mcp" | "skills" | "mixed";

/** 按组件得到类型标签：只有界面（可带后端）为应用，只有 MCP 为 MCP，只有技能为技能，其余为混合。 */
export function appType(components: Component[] | undefined): AppType {
  const list = components ?? ["ui"];
  const visible = list.filter((item) => item !== "backend");
  if (visible.length === 1 && visible[0] === "ui") return "app";
  if (list.length === 1 && list[0] === "mcp") return "mcp";
  if (list.length === 1 && list[0] === "skills") return "skills";
  return "mixed";
}

export const appTypeLabels: Record<AppType, string> = {
  app: "应用",
  mcp: "MCP",
  skills: "技能",
  mixed: "混合",
};

export const visibilityLabels: Record<string, string> = {
  public: "公开",
  signed_in: "登录即可",
  app: "应用用户",
};

/** 可见范围的中文说明；permission:<name> 显示为对应的应用内权限名称。 */
export function visibilityLabel(
  value: string,
  permissions: { name: string; title: string }[] = [],
) {
  const name = value.startsWith("permission:")
    ? value.slice("permission:".length)
    : "";
  if (name)
    return `需要「${permissions.find((item) => item.name === name)?.title ?? name}」`;
  return visibilityLabels[value] ?? value;
}

export const severityLabels: Record<Advisory["severity"], string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

export const storageLabels: Record<string, string> = {
  shared: "共享数据",
  public: "公开数据",
  account: "按用户隔离的数据",
};

export const categoryLabels: Record<string, string> = {
  productivity: "效率",
  tools: "工具",
  monitoring: "监控",
  data: "数据",
  communication: "沟通",
  developer: "开发",
  other: "其他",
};

export const pricingLabels: Record<Pricing, string> = {
  free: "免费",
  freemium: "基础免费",
  subscription: "需订阅服务",
};

export const capabilityLabels: Record<string, string> = {
  gateway_page: "上游页面",
  gateway_api: "调用系统接口",
  desktop_widget: "桌面卡片",
  widget: "数据卡片",
  "widget.account_selector": "卡片账号切换",
  window: "自定义窗口尺寸",
  "window.min_size": "窗口最小尺寸",
  "format.2": "格式 2",
  "surface.standalone": "独立页面",
  "surface.public": "公开页面",
  "surface.public.session": "公开页面读取登录状态",
  "access.permissions": "应用内权限",
  "access.default_grant": "默认授予",
  "backend.token_scopes": "个人令牌接口权限点",
  "provides.builtin_import": "导入内置配置",
  "mcp.tools": "AI 工具",
  "mcp.declarative": "声明式工具",
  "mcp.remote": "远程 MCP",
  "mcp.resources": "AI 资源",
  "mcp.prompts": "提示模板",
  skills: "技能",
};

/** 能力标记的展示名称；没有登记的标记按前缀给出通用说明。 */
export function capabilityLabel(mark: string) {
  if (capabilityLabels[mark]) return capabilityLabels[mark];
  if (mark.startsWith("platform."))
    return `平台接口 v${mark.slice("platform.".length)}`;
  if (mark.startsWith("backend.")) return "后端模块";
  if (mark.startsWith("storage."))
    return storageLabels[mark.slice("storage.".length)] ?? mark;
  if (mark.startsWith("uses.")) return `平台能力 ${mark.slice("uses.".length)}`;
  if (mark.startsWith("provides."))
    return `扩展点 ${mark.slice("provides.".length)}`;
  return mark;
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("zh-CN");
}
