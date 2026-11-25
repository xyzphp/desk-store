import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyzos/desk-ui/styles.css';
import './site.css';
import { Layout } from './components/Layout';
import { AppDetailPage } from './pages/AppDetail';
import { AppList } from './pages/AppList';
import { Docs } from './pages/Docs';
import { Home } from './pages/Home';
import { href, useRoute } from './router';

function App() {
  const route = useRoute();
  let page;
  switch (route.name) {
    case 'home':
      page = <Home />;
      break;
    case 'apps':
      page = <AppList category={route.category} />;
      break;
    case 'app':
      page = <AppDetailPage slug={route.slug} />;
      break;
    case 'docs':
      page = <Docs section={route.section} page={route.page} />;
      break;
    default:
      page = (
        <section className="store-section store-section--first">
          <h1>页面不存在</h1>
          <a href={href({ name: 'home' })}>返回首页</a>
        </section>
      );
  }
  return <Layout route={route}>{page}</Layout>;
}

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 挂载点');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
