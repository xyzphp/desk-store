import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 商店网站是纯静态应用（hash 路由、相对 base）。`appcheck build` 把应用数据生成到
// ../dist/public，开发与构建都把它作为静态目录；构建产物输出到 ../dist/site。
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: '../dist/public',
  server: { host: '0.0.0.0', port: 5180, strictPort: true, fs: { allow: ['..'] } },
  build: { outDir: '../dist/site', emptyOutDir: true, sourcemap: false },
});
