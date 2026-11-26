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
  capabilityLabels,
  categoryLabels,
  fetchApp,
  formatBytes,
  formatDate,
  pricingLabels,
  resolveAsset,
  storeAddress,
  type AppDetail,
  type PermissionSummary,
} from '../api';
import { href } from '../router';
import { useData } from '../useData';

function Permissions({ summary }: { summary: PermissionSummary }) {
  return (
    <ul className="store-permissions">
      <li>{summary.entry === 'gateway_page' ? '页面来自经网关代理的上游服务' : '页面为包内静态文件'}</li>
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
    </ul>
  );
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
                        {capabilityLabels[capability] ?? capability}
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
        <DetailSection title="版本">
          <Timeline label="版本记录" items={versionItems(app)} />
        </DetailSection>
      </DetailLayout>
    </div>
  );
}
