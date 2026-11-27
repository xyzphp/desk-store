import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild-wasm';

const root = dirname(fileURLToPath(import.meta.url));
const distDir = join(root, 'dist');

const external = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  '@xyzos/desk-ui',
];

await rm(distDir, { recursive: true, force: true });
await mkdir(join(distDir, 'js'), { recursive: true });
await mkdir(join(distDir, 'css'), { recursive: true });

// 1. 构建工作台应用（入口 index.html -> js/workbench.js + css/workbench.css）
await esbuild.build({
  entryPoints: [join(root, 'src/workbench-entry.tsx')],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  external,
  outfile: join(distDir, 'js/workbench.js'),
  loader: {
    '.css': 'css',
  },
});

// esbuild 在 outfile 为 js/workbench.js 时会把同源 CSS 写到 js/workbench.css，挪到 css/workbench.css
const emittedWorkbenchCss = join(distDir, 'js/workbench.css');
try {
  await access(emittedWorkbenchCss);
  await rename(emittedWorkbenchCss, join(distDir, 'css/workbench.css'));
} catch {
  await writeFile(join(distDir, 'css/workbench.css'), '', 'utf8');
}

// 2. 构建公开阅读站脚本（由 /public/ssr HTML 加载 js/public.js）
await esbuild.build({
  entryPoints: [join(root, 'src/public-entry.tsx')],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  external,
  outfile: join(distDir, 'js/public.js'),
});

// 3. 生成工作台入口 index.html（由宿主注入托管 React / @xyzos/desk-ui importmap 与样式）
const indexHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="xyzos-desk-ui" content="1" />
  <title>文章</title>
  <link rel="stylesheet" href="css/workbench.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="js/workbench.js"></script>
</body>
</html>
`;

await writeFile(join(distDir, 'index.html'), indexHtml, 'utf8');
