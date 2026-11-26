// 示例界面没有依赖：把 app/ 下的文件原样复制到 dist/。真实应用可以在这里换成 Vite 等构建工具。
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('app', 'dist', { recursive: true });
