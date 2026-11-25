import { Button, CodeBlock, Icon, type IconName } from '@xyzos/desk-ui';
import { fetchIndex, storeAddress } from '../api';
import { AppCard } from '../components/AppCard';
import { href, navigate } from '../router';
import { useData } from '../useData';

const features: { icon: IconName; title: string; text: string }[] = [
  { icon: 'code-xml', title: '源码即应用', text: '每个应用都是仓库里的一个目录，通过 Pull Request 提交。评审看的就是源码和版本差异。' },
  { icon: 'shield-check', title: '签名发布', text: '合并后由 CI 确定性打包并用商店密钥签名，系统安装前校验签名与哈希。' },
  { icon: 'boxes', title: '沙箱运行', text: '应用运行在不透明源的沙箱中，接口与数据只能经声明过的受控代理访问。' },
  { icon: 'globe', title: '可以自建', text: '商店是纯静态站点。Fork 仓库、配置签名密钥，就能为团队搭一个自己的商店。' },
];

const steps = [
  { title: '编写应用', text: '在 apps/<slug>/package 放入清单、图标和静态页面。' },
  { title: '本地校验', text: '运行 appcheck check，打包后上传到本地系统联调。' },
  { title: '提交 PR', text: 'CI 校验包结构、版本号，并列出权限摘要供评审。' },
  { title: '合并发布', text: '合并后自动打包、签名，出现在商店与系统的应用商店里。' },
];

export function Home() {
  const index = useData(fetchIndex, 'index');
  const apps = index.status === 'ready' ? index.data.apps.filter((app) => !app.withdrawn).slice(0, 6) : [];
  return (
    <>
      <section className="store-hero">
        <p className="store-eyebrow">开源应用商店</p>
        <h1>为浏览器桌面挑选和开发应用</h1>
        <p className="store-hero-lead">
          Desk Store 收录以源码形式提交的开源应用。在系统中添加这个商店源，就能直接搜索、安装和更新；开发者按文档编写应用，提交 Pull Request 即可上架。
        </p>
        <div className="store-hero-actions">
          <Button variant="primary" icon="layout-grid" onClick={() => navigate({ name: 'apps' })}>
            浏览应用
          </Button>
          <Button icon="book-open" onClick={() => navigate({ name: 'docs', section: 'develop' })}>
            开发应用
          </Button>
        </div>
      </section>

      <section className="store-section">
        <div className="store-features">
          {features.map((feature) => (
            <article key={feature.title} className="store-feature">
              <Icon name={feature.icon} />
              <h2>{feature.title}</h2>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="store-section">
        <div className="store-section-head">
          <h2>最新应用</h2>
          <a href={href({ name: 'apps' })}>查看全部</a>
        </div>
        {index.status === 'loading' && <p className="store-muted">正在读取应用列表…</p>}
        {index.status === 'error' && <p className="store-muted">应用列表读取失败：{index.message}</p>}
        {index.status === 'ready' && apps.length === 0 && <p className="store-muted">还没有上架的应用。</p>}
        <div className="store-grid">
          {apps.map((app) => (
            <AppCard key={app.slug} app={app} />
          ))}
        </div>
      </section>

      <section className="store-section store-split">
        <div>
          <h2>在系统中使用</h2>
          <p>
            管理员打开「应用管理 → 应用商店 → 商店源」，添加下面的商店地址并核对签名公钥指纹。之后即可在「应用商店」中浏览、安装和更新应用；安装仍需确认权限、配置代理与凭据。
          </p>
          <CodeBlock code={storeAddress()} label="商店地址" />
          <p>
            <a href={href({ name: 'docs', section: 'site', page: 'install-in-xyzos' })}>查看完整步骤</a>
          </p>
        </div>
        <div>
          <h2>提交一个应用</h2>
          <ol className="store-steps">
            {steps.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
          <p>
            <a href={href({ name: 'docs', section: 'develop', page: 'quick-start' })}>从快速开始读起</a>
          </p>
        </div>
      </section>
    </>
  );
}
