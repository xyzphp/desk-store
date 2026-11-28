import { useState } from "react";
import {
  Inline,
  Panel,
  Property,
  PropertySheet,
  SegmentedControl,
  Stack,
  Table,
  Tag,
  Text,
} from "@xyzos/desk-ui";
import {
  capabilityLabel,
  formatBytes,
  storageLabels,
  visibilityLabel,
  visibilityLabels,
  type AppVersion,
  type PermissionSummary,
} from "../api";

type RouteRow = NonNullable<PermissionSummary["backend"]>["routes"][number];
type VisibilityBucket = "all" | "app" | "signed_in" | "permission" | "public";

const toolKindLabels = {
  backend: "后端实现",
  declarative: "声明式",
  remote: "远程 MCP",
};

function methodTag(method: string) {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD")
    return (
      <Tag key={method} color="blue">
        {upper}
      </Tag>
    );
  if (upper === "POST")
    return (
      <Tag key={method} tone="success">
        {upper}
      </Tag>
    );
  if (upper === "PUT" || upper === "PATCH")
    return (
      <Tag key={method} tone="warning">
        {upper}
      </Tag>
    );
  if (upper === "DELETE")
    return (
      <Tag key={method} tone="danger">
        {upper}
      </Tag>
    );
  return <Tag key={method}>{upper}</Tag>;
}

function visibilityBucket(value: string): Exclude<VisibilityBucket, "all"> {
  if (value === "public") return "public";
  if (value === "signed_in") return "signed_in";
  if (value.startsWith("permission:")) return "permission";
  return "app";
}

function visibilityTag(
  value: string,
  permissions: { name: string; title: string }[],
) {
  const label = visibilityLabel(value, permissions);
  if (value.startsWith("permission:")) return <Tag color="purple">{label}</Tag>;
  if (value === "public") return <Tag tone="warning">{label}</Tag>;
  if (value === "signed_in") return <Tag tone="info">{label}</Tag>;
  return <Tag tone="neutral">{label}</Tag>;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function auditCell(row: RouteRow) {
  const mode = row.audit?.mode || "write";
  if (mode === "off") {
    return <Tag tone="muted">不记日志</Tag>;
  }
  if (mode === "all") {
    return (
      <Inline gap="xs">
        <Tag tone="info">全量入账</Tag>
        {row.audit?.label && (
          <Text size="sm" tone="muted">
            {row.audit.label}
          </Text>
        )}
      </Inline>
    );
  }
  const hasWrite = row.methods.some((method) =>
    WRITE_METHODS.has(method.toUpperCase()),
  );
  if (!hasWrite) {
    return <Tag tone="muted">只读不记</Tag>;
  }
  return (
    <Inline gap="xs">
      <Tag tone="success">写操作入账</Tag>
      {row.audit?.label && (
        <Text size="sm" tone="muted">
          {row.audit.label}
        </Text>
      )}
    </Inline>
  );
}

/** 是否存在需要展示「接口与集成」页签的接口、代理或外联能力（MCP 与技能单独归入「AI 与技能」页签）。 */
export function hasApiIntegration(
  summary: PermissionSummary | undefined,
): boolean {
  if (!summary) return false;
  const backend = summary.backend;
  return Boolean(
    backend?.routes.length ||
    summary.proxies.length ||
    summary.gatewayApi.length ||
    backend?.http.length ||
    backend?.schedules.length ||
    backend?.hooks.length,
  );
}

/** 是否声明了 MCP 工具 / 资源 / 提示模板或远程 MCP，决定是否展示独立的「MCP」页签。 */
export function hasMcpComponents(
  summary: PermissionSummary | undefined,
): boolean {
  if (!summary) return false;
  const mcp = summary.mcp;
  return Boolean(
    mcp?.tools.length ||
    mcp?.resources.length ||
    mcp?.prompts.length ||
    mcp?.remote,
  );
}

/** 是否声明了技能，决定是否展示独立的「技能」页签。 */
export function hasSkillComponents(
  summary: PermissionSummary | undefined,
): boolean {
  return Boolean(summary?.skills?.length);
}

/** 右侧紧凑的「能力概览」卡片：汇总版本、入口、后端接口、存储、AI 与网络特征。 */
export function CapabilitySummaryPanel({ version }: { version: AppVersion }) {
  const summary = version.permissions;
  const backend = summary.backend;
  const scopes = backend
    ? (["shared", "public", "account"] as const)
        .filter((scope) => backend.storage[scope])
        .map((scope) => storageLabels[scope])
    : [];
  const surfaces: string[] = [];
  if (summary.entry !== "none") surfaces.push("桌面窗口");
  if (summary.surfaces?.standalone) surfaces.push("独立页");
  if (summary.surfaces?.public) surfaces.push("公开页");
  if (summary.desktopWidget) surfaces.push("桌面卡片");

  const aiParts = [
    summary.mcp?.tools.length ? `${summary.mcp.tools.length} 工具` : "",
    summary.mcp?.resources.length ? `${summary.mcp.resources.length} 资源` : "",
    summary.mcp?.prompts.length ? `${summary.mcp.prompts.length} 提示` : "",
    summary.skills?.length ? `${summary.skills.length} 技能` : "",
  ].filter(Boolean);

  const networkParts = [
    summary.proxies.length ? `${summary.proxies.length} 项代理` : "",
    backend?.http.length ? `${backend.http.length} 个外联主机` : "",
  ].filter(Boolean);

  return (
    <Panel title="能力概览">
      <PropertySheet density="compact">
        <Property label="最新版本">{`v${version.version} · ${formatBytes(version.size)}`}</Property>
        {surfaces.length > 0 && (
          <Property label="访问形态">
            <Inline gap="xs">
              {surfaces.map((item) => (
                <Tag key={item} tone="muted">
                  {item}
                </Tag>
              ))}
            </Inline>
          </Property>
        )}
        <Property label="后端接口">
          {backend ? `${backend.routes.length} 个接口` : "纯前端包"}
        </Property>
        {scopes.length > 0 && (
          <Property label="数据存储">{scopes.join("、")}</Property>
        )}
        {aiParts.length > 0 && (
          <Property label="AI 能力">{aiParts.join(" · ")}</Property>
        )}
        <Property label="网络访问">
          {networkParts.length > 0 ? networkParts.join(" · ") : "无外部访问"}
        </Property>
      </PropertySheet>
    </Panel>
  );
}

/** 「接口与集成」页签：按后端接口表、外部代理、系统接口与外联调度分块展示。 */
export function ApiIntegrationTab({ summary }: { summary: PermissionSummary }) {
  const [bucket, setBucket] = useState<VisibilityBucket>("all");
  const permissions = summary.access?.permissions ?? [];
  const backend = summary.backend;
  const routes = backend?.routes ?? [];
  const hasOutbound = Boolean(
    backend?.http.length || backend?.schedules.length || backend?.hooks.length,
  );

  const counts: Record<Exclude<VisibilityBucket, "all">, number> = {
    app: 0,
    signed_in: 0,
    permission: 0,
    public: 0,
  };
  for (const route of routes) counts[visibilityBucket(route.visibility)] += 1;
  const filterOptions = [
    { value: "all", label: `全部 (${routes.length})` },
    ...(counts.app > 0
      ? [{ value: "app", label: `${visibilityLabels.app} (${counts.app})` }]
      : []),
    ...(counts.signed_in > 0
      ? [
          {
            value: "signed_in",
            label: `${visibilityLabels.signed_in} (${counts.signed_in})`,
          },
        ]
      : []),
    ...(counts.permission > 0
      ? [{ value: "permission", label: `应用内权限 (${counts.permission})` }]
      : []),
    ...(counts.public > 0
      ? [
          {
            value: "public",
            label: `${visibilityLabels.public} (${counts.public})`,
          },
        ]
      : []),
  ];
  const activeBucket: VisibilityBucket = filterOptions.some(
    (opt) => opt.value === bucket,
  )
    ? bucket
    : "all";
  const filteredRoutes =
    activeBucket === "all"
      ? routes
      : routes.filter(
          (route) => visibilityBucket(route.visibility) === activeBucket,
        );

  return (
    <Stack gap="md">
      {routes.length > 0 && (
        <Panel title={`后端接口（${routes.length}）`}>
          {filterOptions.length > 2 && (
            <SegmentedControl
              variant="settings"
              aria-label="按访问范围筛选接口"
              options={filterOptions}
              value={activeBucket}
              onChange={(value) => setBucket(value as VisibilityBucket)}
            />
          )}
          <div className="store-table-frame">
            <Table<RouteRow>
              caption="应用后端接口列表"
              wrap
              rows={filteredRoutes}
              rowKey={(row) => `${row.methods.join("/")} ${row.path}`}
              columns={[
                {
                  key: "methods",
                  header: "方法",
                  width: "104px",
                  render: (row) => (
                    <Inline gap="xs">
                      {row.methods.map((method) => methodTag(method))}
                    </Inline>
                  ),
                },
                {
                  key: "path",
                  header: "路径",
                  render: (row) => (
                    <Text code size="sm">
                      {row.path}
                    </Text>
                  ),
                },
                {
                  key: "visibility",
                  header: "访问权限",
                  width: "142px",
                  render: (row) => visibilityTag(row.visibility, permissions),
                },
                {
                  key: "audit",
                  header: "系统日志",
                  width: "176px",
                  render: (row) => auditCell(row),
                },
              ]}
            />
          </div>
        </Panel>
      )}
      {summary.proxies.length > 0 && (
        <Panel title={`外部服务代理（${summary.proxies.length}）`}>
          <Stack gap="sm">
            {summary.proxies.map((proxy) => (
              <div key={proxy.key} className="store-spec-item">
                <Inline gap="xs">
                  <strong>{proxy.title}</strong>
                  <Tag tone={proxy.needsCredential ? "warning" : "muted"}>
                    {proxy.needsCredential
                      ? `需填写凭据（${proxy.authType}）`
                      : "无需凭据"}
                  </Tag>
                  {proxy.baseUrlEditable && (
                    <Tag tone="info">安装时可修改地址</Tag>
                  )}
                </Inline>
                <PropertySheet density="compact">
                  <Property label="上游地址">
                    <Text code size="sm">
                      {proxy.upstream}
                    </Text>
                  </Property>
                  <Property label="请求方法">
                    <Inline gap="xs">
                      {proxy.methods.map((method) => methodTag(method))}
                    </Inline>
                  </Property>
                  {proxy.paths.length > 0 && (
                    <Property label="代理路径">
                      <Inline gap="xs">
                        {proxy.paths.map((path) => (
                          <Text key={path} code size="sm">
                            {path}
                          </Text>
                        ))}
                      </Inline>
                    </Property>
                  )}
                </PropertySheet>
              </div>
            ))}
          </Stack>
        </Panel>
      )}
      {summary.gatewayApi.length > 0 && (
        <Panel title="系统接口调用">
          <Text as="p" tone="muted" size="sm">
            以当前用户身份调用系统接口：
          </Text>
          <Inline gap="xs">
            {summary.gatewayApi.map((scope) => (
              <Text key={scope} code size="sm">
                {scope}
              </Text>
            ))}
          </Inline>
        </Panel>
      )}
      {hasOutbound && backend && (
        <Panel title="外联主机与定时任务">
          <PropertySheet density="compact">
            {backend.http.length > 0 && (
              <Property label="外联主机">
                <Inline gap="xs">
                  {backend.http.map((host) => (
                    <Text key={host} code size="sm">
                      {host}
                    </Text>
                  ))}
                </Inline>
              </Property>
            )}
            {backend.schedules.length > 0 && (
              <Property label="定时任务">
                <Inline gap="xs">
                  {backend.schedules.map((job) => (
                    <Tag key={job} tone="muted">
                      {job}
                    </Tag>
                  ))}
                </Inline>
              </Property>
            )}
            {backend.hooks.length > 0 && (
              <Property label="系统钩子">
                <Inline gap="xs">
                  {backend.hooks.map((hook) => (
                    <Tag key={hook} tone="muted">
                      {hook}
                    </Tag>
                  ))}
                </Inline>
              </Property>
            )}
          </PropertySheet>
        </Panel>
      )}
    </Stack>
  );
}

/** 「MCP」独立页签：分卡片展示 MCP 工具、只读资源、提示模板与远程 MCP。 */
export function McpTab({
  slug,
  summary,
}: {
  slug: string;
  summary: PermissionSummary;
}) {
  const tools = summary.mcp?.tools ?? [];
  const resources = summary.mcp?.resources ?? [];
  const prompts = summary.mcp?.prompts ?? [];
  const remote = summary.mcp?.remote;

  return (
    <Stack gap="md">
      {tools.length > 0 && (
        <Panel title={`MCP 工具（${tools.length}）`}>
          <Stack gap="sm">
            {tools.map((tool) => (
              <div key={tool.name} className="store-spec-item">
                <Inline gap="xs">
                  <strong>{tool.title}</strong>
                  <Text code size="sm">
                    {slug}.{tool.name}
                  </Text>
                  <Tag tone="muted">{toolKindLabels[tool.kind]}</Tag>
                  {tool.readOnly && <Tag tone="success">只读</Tag>}
                  {tool.destructive && (
                    <Tag tone="warning">有副作用，调用前确认</Tag>
                  )}
                </Inline>
                <Text as="p" tone="muted" size="sm">
                  {tool.description}
                </Text>
              </div>
            ))}
          </Stack>
        </Panel>
      )}
      {resources.length > 0 && (
        <Panel title={`只读资源（${resources.length}）`}>
          <Stack gap="xs">
            {resources.map((resource) => (
              <div key={resource.uri} className="store-spec-item">
                <Inline gap="xs">
                  <strong>{resource.title}</strong>
                  <Text code size="sm">
                    {resource.uri}
                  </Text>
                </Inline>
              </div>
            ))}
          </Stack>
        </Panel>
      )}
      {prompts.length > 0 && (
        <Panel title={`提示模板（${prompts.length}）`}>
          <Stack gap="xs">
            {prompts.map((prompt) => (
              <div key={prompt.name} className="store-spec-item">
                <Inline gap="xs">
                  <strong>{prompt.title}</strong>
                  <Text code size="sm">
                    {slug}.{prompt.name}
                  </Text>
                </Inline>
              </div>
            ))}
          </Stack>
        </Panel>
      )}
      {remote && (
        <Panel title="远程 MCP">
          <div className="store-spec-item">
            <PropertySheet density="compact">
              <Property label="代理标识">
                <Text code size="sm">
                  {remote.proxy}
                </Text>
              </Property>
              {remote.pinnedTools.length > 0 && (
                <Property label="固定工具">
                  <Inline gap="xs">
                    {remote.pinnedTools.map((tool) => (
                      <Text key={tool} code size="sm">
                        {tool}
                      </Text>
                    ))}
                  </Inline>
                </Property>
              )}
            </PropertySheet>
          </div>
        </Panel>
      )}
    </Stack>
  );
}

/** 「权限与安全」页签：按入口、权限、数据隔离与网络边界单列分卡展示，并附完整能力标记。 */
export function PermissionsSecurityTab({
  summary,
}: {
  summary: PermissionSummary;
}) {
  const permissions = summary.access?.permissions ?? [];
  const backend = summary.backend;
  const scopes = backend
    ? (["shared", "public", "account"] as const)
        .filter((scope) => backend.storage[scope])
        .map((scope) => storageLabels[scope])
    : [];
  const pageSource =
    summary.entry === "gateway_page"
      ? "页面来自经网关代理的上游服务"
      : summary.entry === "none"
        ? "无窗口界面"
        : "页面为包内静态文件";
  const hasStorageOrPlatform = Boolean(
    backend ||
    summary.platform?.uses.length ||
    summary.platform?.provides.length,
  );

  return (
    <Stack gap="md">
      <Panel title="页面与访问入口">
        <PropertySheet density="compact">
          <Property label="窗口页面">{pageSource}</Property>
          {summary.surfaces?.standalone && (
            <Property label="独立页面">可在浏览器新标签页独立打开</Property>
          )}
          {summary.surfaces?.public && (
            <Property label="公开页面">
              <span>
                提供公开页面（未登录可访问）
                {summary.surfaces.public.alias && (
                  <>
                    ，建议路径{" "}
                    <Text code size="sm">
                      {summary.surfaces.public.alias}
                    </Text>
                  </>
                )}
                {summary.surfaces.public.session === "optional" &&
                  "，已登录时读取登录状态"}
              </span>
            </Property>
          )}
          {summary.desktopWidget && (
            <Property label="桌面卡片">提供桌面卡片</Property>
          )}
        </PropertySheet>
      </Panel>
      <Panel title="账号与应用内权限">
        <PropertySheet density="compact">
          {summary.access && (
            <Property label="默认授予">
              {summary.access.defaultGrant !== "none"
                ? "安装时建议默认授予所有账号（管理员可以改为不授予）"
                : "默认不自动授予（需管理员授权）"}
            </Property>
          )}
          <Property label="应用内权限">
            {permissions.length === 0 ? (
              "无额外应用内权限"
            ) : (
              <Stack gap="xs">
                {permissions.map((item) => (
                  <Inline key={item.name} gap="xs">
                    <span>{item.title}</span>
                    <Text code size="sm">
                      {item.name}
                    </Text>
                  </Inline>
                ))}
              </Stack>
            )}
          </Property>
          <Property label="系统接口">
            {summary.gatewayApi.length === 0 ? (
              "不调用系统接口"
            ) : (
              <Inline gap="xs">
                {summary.gatewayApi.map((scope) => (
                  <Text key={scope} code size="sm">
                    {scope}
                  </Text>
                ))}
              </Inline>
            )}
          </Property>
        </PropertySheet>
      </Panel>
      {hasStorageOrPlatform && (
        <Panel title="数据存储与平台能力">
          <PropertySheet density="compact">
            <Property label="隔离存储">
              {scopes.length === 0 ? (
                "不保存独立数据"
              ) : (
                <Stack gap="xs">
                  <Inline gap="xs">
                    {scopes.map((scope) => (
                      <Tag key={scope} tone="info">
                        {scope}
                      </Tag>
                    ))}
                  </Inline>
                  <Text tone="muted" size="sm">
                    与系统主库隔离
                  </Text>
                </Stack>
              )}
            </Property>
            {backend && backend.config.length > 0 && (
              <Property label="安装配置项">
                <Stack gap="xs">
                  {backend.config.map((item) => (
                    <Inline key={item.key} gap="xs">
                      <span>{item.title}</span>
                      {item.secret && <Tag tone="warning">加密保存</Tag>}
                    </Inline>
                  ))}
                </Stack>
              </Property>
            )}
            {summary.platform && summary.platform.uses.length > 0 && (
              <Property label="平台能力">
                <Inline gap="xs">
                  {summary.platform.uses.map((cap) => (
                    <Tag key={cap} tone="muted">
                      {cap}
                    </Tag>
                  ))}
                </Inline>
              </Property>
            )}
            {summary.platform && summary.platform.provides.length > 0 && (
              <Property label="扩展点">
                <Inline gap="xs">
                  {summary.platform.provides.map((item) => (
                    <Tag key={item} tone="muted">
                      {item}
                    </Tag>
                  ))}
                </Inline>
              </Property>
            )}
          </PropertySheet>
        </Panel>
      )}
      <Panel title="网络与外联边界">
        <PropertySheet density="compact">
          <Property label="外部代理">
            {summary.proxies.length === 0 ? (
              "不访问外部服务"
            ) : (
              <Stack gap="xs">
                {summary.proxies.map((proxy) => (
                  <Stack key={proxy.key} gap="xs">
                    <Inline gap="xs">
                      <strong>{proxy.title}</strong>
                      <Text code size="sm">
                        {proxy.upstream}
                      </Text>
                    </Inline>
                    <Text tone="muted" size="sm">
                      {proxy.needsCredential
                        ? `需要管理员填写凭据（${proxy.authType}）`
                        : "无需凭据"}
                    </Text>
                  </Stack>
                ))}
              </Stack>
            )}
          </Property>
          <Property label="后端外联">
            {!backend || backend.http.length === 0 ? (
              "无声明外联主机"
            ) : (
              <Inline gap="xs">
                {backend.http.map((host) => (
                  <Text key={host} code size="sm">
                    {host}
                  </Text>
                ))}
              </Inline>
            )}
          </Property>
          {backend && backend.schedules.length > 0 && (
            <Property label="定时任务">
              <Inline gap="xs">
                {backend.schedules.map((job) => (
                  <Tag key={job} tone="muted">
                    {job}
                  </Tag>
                ))}
              </Inline>
            </Property>
          )}
        </PropertySheet>
      </Panel>
      {summary.capabilities.length > 0 && (
        <Panel title="能力标记">
          <Inline gap="xs">
            {summary.capabilities.map((capability) => (
              <Tag key={capability} tone="muted">
                {capabilityLabel(capability)}
              </Tag>
            ))}
          </Inline>
        </Panel>
      )}
    </Stack>
  );
}
