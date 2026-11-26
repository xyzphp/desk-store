import {
  AppIcon,
  Button,
  CodeBlock,
  DetailLayout,
  DetailSection,
  ImageGallery,
  Inline,
  MarkdownView,
  Notice,
  Panel,
  Property,
  PropertySheet,
  Stack,
  Tag,
  Text,
  Timeline,
} from '@xyzos/desk-ui';
import {
  appType,
  appTypeLabels,
  capabilityLabel,
  categoryLabels,
  fetchAdvisories,
  fetchApp,
  formatBytes,
  formatDate,
  pricingLabels,
  resolveAsset,
  severityLabels,
  storageLabels,
  storeAddress,
  visibilityLabel,
  type AppDetail,
  type PermissionSummary,
} from '../api';
import { href } from '../router';
import { useData } from '../useData';

function Permissions({ summary }: { summary: PermissionSummary }) {
  return (
    <ul className="store-permissions">
      <li>
        {summary.entry === 'gateway_page'
          ? '页面来自经网关代理的上游服务'
          : summary.entry === 'none'
            ? '没有窗口界面'
            : '页面为包内静态文件'}
      </li>
      <li>
        {summary.gatewayApi.length === 0 ? (
          '不调用系统接口'
        ) : (
          <>
            以当前用户身份调用系统接口：
            {summary.gatewayApi.map((scope) => (
              <code key={scope}>{scope}</code>
            ))}
          </>
        )}
      </li>
      {summary.proxies.length === 0 && <li>不访问外部服务</li>}
      {summary.proxies.map((proxy) => (
        <li key={proxy.key}>
          访问 <strong>{proxy.title}</strong>：<code>{proxy.upstream}</code>
          {proxy.baseUrlEditable && '（安装时可修改地址）'}，方法 {proxy.methods.join(' / ')}，路径{' '}
          {proxy.paths.map((path) => (
            <code key={path}>{path}</code>
          ))}
          {proxy.needsCredential ? `，需要管理员填写凭据（${proxy.authType}）` : '，无需凭据'}
        </li>
      ))}
      {summary.desktopWidget && <li>提供桌面卡片</li>}
      <FormatTwoPermissions summary={summary} />
    </ul>
  );
}

/** 格式 2 的应用内权限、入口与后端摘要。 */
function FormatTwoPermissions({ summary }: { summary: PermissionSummary }) {
  const permissions = summary.access?.permissions ?? [];
  const backend = summary.backend;
  const scopes = backend
    ? (['shared', 'public', 'account'] as const).filter((scope) => backend.storage[scope]).map((scope) => storageLabels[scope])
    : [];
  return (
    <>
      {permissions.length > 0 && <li>应用内权限：{permissions.map((item) => item.title).join('、')}</li>}
      {summary.access && summary.access.defaultGrant !== 'none' && <li>安装时建议默认授予所有账号（管理员可以改为不授予）</li>}
      {summary.surfaces?.standalone && <li>可在浏览器新标签页独立打开</li>}
      {summary.surfaces?.public && (
        <li>
          <strong>提供公开页面（未登录可访问）</strong>
          {summary.surfaces.public.alias && (
            <>
              ，建议路径 <code>{summary.surfaces.public.alias}</code>
            </>
          )}
          {summary.surfaces.public.session === 'optional' && '，已登录时读取登录状态'}
        </li>
      )}
      {backend && (
        <li>
          带后端模块，提供 {backend.routes.length} 个接口
          {backend.routes.map((route) => (
            <code key={`${route.methods.join('/')} ${route.path}`}>
              {route.methods.join('/')} {route.path}（{visibilityLabel(route.visibility, permissions)}）
            </code>
          ))}
        </li>
      )}
      {scopes.length > 0 && <li>保存{scopes.join('、')}，与系统主库隔离</li>}
      {backend && backend.http.length > 0 && (
        <li>
          后端可访问：
          {backend.http.map((host) => (
            <code key={host}>{host}</code>
          ))}
        </li>
      )}
      {backend && backend.schedules.length > 0 && <li>定时任务：{backend.schedules.join('、')}</li>}
      {backend && backend.config.length > 0 && (
        <li>安装时需要填写：{backend.config.map((item) => item.title + (item.secret ? '（加密保存）' : '')).join('、')}</li>
      )}
      {summary.platform && summary.platform.uses.length > 0 && <li>平台能力：{summary.platform.uses.join('、')}</li>}
    </>
  );
}

/** AI 工具、提示模板与技能。 */
function AIComponents({ summary }: { summary: PermissionSummary }) {
  const tools = summary.mcp?.tools ?? [];
  const skills = summary.skills ?? [];
  const kinds = { backend: '后端实现', declarative: '声明式', remote: '远程 MCP' };
  return (
    <Stack gap="sm">
      {tools.map((tool) => (
        <div key={tool.name} className="store-ai-item">
          <Inline gap="xs">
            <strong>{tool.title}</strong>
            <Text code size="sm">
              {tool.name}
            </Text>
            <Tag tone="muted">{kinds[tool.kind]}</Tag>
            {tool.readOnly && <Tag tone="success">只读</Tag>}
            {tool.destructive && <Tag tone="warning">有副作用，调用前确认</Tag>}
          </Inline>
          <Text as="p" tone="muted" size="sm">
            {tool.description}
          </Text>
        </div>
      ))}
      {(summary.mcp?.prompts.length ?? 0) > 0 && (
        <Text as="p" tone="muted" size="sm">
          提示模板：{summary.mcp?.prompts.map((prompt) => prompt.title).join('、')}
        </Text>
      )}
      {skills.map((skill) => (
        <div key={skill.name} className="store-ai-item">
          <Inline gap="xs">
            <strong>技能</strong>
            <Text code size="sm">
              {skill.name}
            </Text>
          </Inline>
          <Text as="p" tone="muted" size="sm">
            {skill.description}
          </Text>
        </div>
      ))}
    </Stack>
  );
}

function migrationCount(version: AppDetail['versions'][number]) {
  return Object.values(version.migrations ?? {}).reduce((total, list) => total + list.length, 0);
}

function versionItems(app: AppDetail) {
  return app.versions.map((version) => ({
    id: version.version,
    title: `v${version.version}`,
    time: `${formatDate(version.publishedAt)} · ${formatBytes(version.size)}`,
    dateTime: version.publishedAt,
    content: (
      <Stack gap="xs">
        {(version.version === app.latestVersion || version.yanked) && (
          <Inline gap="xs">
            {version.version === app.latestVersion && <Tag tone="success">最新</Tag>}
            {version.yanked && <Tag tone="danger">已撤回</Tag>}
          </Inline>
        )}
        {version.changelog && <MarkdownView className="store-markdown" value={version.changelog} />}
        {migrationCount(version) > 0 && (
          <Text tone="muted" size="sm">
            包含 {migrationCount(version)} 个数据库迁移文件，更新时由系统按顺序执行
          </Text>
        )}
        <Text tone="muted" size="sm" code title="安装包 SHA-256">
          sha256 {version.sha256}
        </Text>
      </Stack>
    ),
  }));
}

function Facts({ app }: { app: AppDetail }) {
  return (
    <PropertySheet density="compact">
      <Property label="标识">
        <Text code>{app.slug}</Text>
      </Property>
      <Property label="作者">
        {app.authors.map((author, index) => (
          <span key={author.name}>
            {index > 0 && '、'}
            {author.url ? (
              <a href={author.url} target="_blank" rel="noopener noreferrer">
                {author.name}
              </a>
            ) : (
              author.name
            )}
          </span>
        ))}
      </Property>
      <Property label="许可证">{app.license}</Property>
      {app.source && (
        <Property label="源码">
          <a href={app.source} target="_blank" rel="noopener noreferrer">
            在商店仓库中查看
          </a>
        </Property>
      )}
      {app.homepage && (
        <Property label="主页">
          <a href={app.homepage} target="_blank" rel="noopener noreferrer">
            {new URL(app.homepage).host}
          </a>
        </Property>
      )}
    </PropertySheet>
  );
}

export function AppDetailPage({ slug }: { slug: string }) {
  const state = useData(() => fetchApp(slug), slug);
  const advisoryState = useData(fetchAdvisories, 'advisories');
  if (state.status === 'loading') return <p className="store-section store-muted">正在读取应用…</p>;
  if (state.status === 'error') {
    return (
      <section className="store-section store-section--first">
        <h1>没有找到这个应用</h1>
        <p className="store-muted">读取 {slug} 失败：{state.message}</p>
        <a href={href({ name: 'apps' })}>返回应用列表</a>
      </section>
    );
  }
  const app = state.data;
  const latest = app.versions.find((version) => version.version === app.latestVersion) ?? app.versions[0];
  const type = appType(latest?.components);
  const advisories = advisoryState.status === 'ready' ? advisoryState.data.filter((item) => item.slug === app.slug) : [];
  const hasAI = Boolean(latest?.permissions.mcp || latest?.permissions.skills?.length);
  return (
    <div className="store-section store-section--first">
      <a className="store-back" href={href({ name: 'apps' })}>
        ← 全部应用
      </a>
      <DetailLayout
        headingLevel={1}
        media={<AppIcon image={resolveAsset(app.icon) || undefined} glyph={app.name.slice(0, 1)} size={88} />}
        title={app.name}
        description={app.summary}
        meta={
          <>
            <a href={href({ name: 'apps', category: app.category })}>
              <Tag color="blue">{categoryLabels[app.category] ?? app.category}</Tag>
            </a>
            {type !== 'app' && <Tag color="purple">{appTypeLabels[type]}</Tag>}
            <Tag tone={app.pricing === 'free' ? 'success' : 'warning'}>{pricingLabels[app.pricing]}</Tag>
            {app.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </>
        }
        actions={
          latest &&
          !app.withdrawn && (
            <Button
              variant="primary"
              icon="download"
              onClick={() => window.open(resolveAsset(latest.url), '_blank', 'noopener')}
            >
              下载 v{latest.version}
            </Button>
          )
        }
        aside={
          <>
            <Panel title="安装到系统">
              <ol className="store-install-steps">
                <li>在「应用管理 → 应用商店 → 商店源」添加商店地址：</li>
              </ol>
              <CodeBlock code={storeAddress()} label="商店地址" />
              <ol className="store-install-steps" start={2}>
                <li>在「应用商店」中找到「{app.name}」，点击安装。</li>
                <li>确认权限，按提示填写服务地址与凭据。</li>
                <li>在账号或角色管理中把应用授权给需要的人。</li>
              </ol>
            </Panel>
            {latest && (
              <Panel title="权限与访问">
                <Permissions summary={latest.permissions} />
                {latest.permissions.capabilities.length > 0 && (
                  <Inline gap="xs">
                    {latest.permissions.capabilities.map((capability) => (
                      <Tag key={capability} tone="muted">
                        {capabilityLabel(capability)}
                      </Tag>
                    ))}
                  </Inline>
                )}
              </Panel>
            )}
            <Panel title="信息">
              <Facts app={app} />
            </Panel>
          </>
        }
      >
        {advisories.map((advisory) => (
          <Notice key={advisory.id} tone={advisory.severity === 'low' ? 'info' : 'warning'}>
            <strong>
              安全通告 {advisory.id}（{severityLabels[advisory.severity]}）：{advisory.title}
            </strong>
            <br />
            受影响版本 <code>{advisory.versions}</code>
            {advisory.action === 'update' && advisory.fixedIn
              ? `，请更新到 v${advisory.fixedIn} 或更高版本。`
              : '，暂无修复版本，建议停用。'}
          </Notice>
        ))}
        {app.withdrawn && (
          <Notice tone="warning">这个应用已下架，不再提供新安装。已安装的系统会显示提示，可以继续使用或卸载。</Notice>
        )}
        {app.pricing !== 'free' && app.pricingUrl && (
          <Notice tone="info">
            应用本身免费开源，但使用时需要订阅作者提供的外部服务。
            <a href={app.pricingUrl} target="_blank" rel="noopener noreferrer">
              查看服务与价格
            </a>
          </Notice>
        )}
        <DetailSection title="介绍">
          <MarkdownView className="store-markdown" value={app.description || app.summary} />
        </DetailSection>
        {app.screenshots.length > 0 && (
          <DetailSection title="截图">
            <ImageGallery
              label={`${app.name} 截图`}
              items={app.screenshots.map((shot, index) => ({ src: resolveAsset(shot), alt: `${app.name} 截图 ${index + 1}` }))}
            />
          </DetailSection>
        )}
        {hasAI && latest && (
          <DetailSection title="AI 工具与技能">
            <AIComponents summary={latest.permissions} />
          </DetailSection>
        )}
        <DetailSection title="版本">
          <Timeline label="版本记录" items={versionItems(app)} />
        </DetailSection>
      </DetailLayout>
    </div>
  );
}
