# AI-SVC-web-operator-UI

AI SVC（歌唱声音转换）项目的 Web 操作界面，支持音轨编辑、F0 提取、SVC 推理等功能。

## 项目结构

```
aisvc-midi-web/
├── client/          # 前端 (Vue 3 + Vite)
├── server/          # 后端 (Express + TypeScript)
├── data/            # 生成的分组音频数据 (已 gitignore)
├── projects/        # 项目文件（含 blob 二进制文件）(已 gitignore)
├── public/          # 公共资源
├── docs/            # 文档
└── ...
```

## .gitignore 说明

本仓库的 `.gitignore` 排除了以下内容：

### 已忽略的文件/目录

| 条目 | 说明 |
|------|------|
| `node_modules/` | 依赖包，通过 `pnpm install` 安装 |
| `dist/` | 构建产物 |
| `.vite/` | Vite 缓存 |
| `*.asvcproj` | 项目配置文件（含本地路径） |
| `*_data/` | 生成的音频数据目录 |
| `data/` | 音频分组数据（combined.wav 等） |
| `server/data/` | 服务端生成的音频数据 |
| `projects/*/blobs/` | 项目中的大二进制 blob 文件 |
| `projects/*/*.blob` | blob 文件 |
| `public/f0_data.json` | 生成的 F0 数据 |
| `.env` / `.env.*` | 环境变量/密钥配置 |
| `*.log` | 日志文件 |
| `.DS_Store` / `Thumbs.db` | 系统文件 |

### 需要手动补全的内容

克隆仓库后，需根据实际情况手动恢复以下目录：

1. **`projects/`** — 项目文件，包含 `project.json` 和关联的 blob 文件
   - 如果需要恢复已有项目，请将备份的 `projects/` 目录复制回来
   - 或者通过应用界面新建项目

2. **`data/`** 和 **`server/data/`** — 生成的音频分组数据
   - 这些是运行时生成的缓存数据，运行应用后会自动生成
   - 如需要保留已有分组数据，请手动复制回来

3. **`node_modules/`** — 依赖包
   - 运行 `pnpm install` 自动安装

4. **`.env`** — 环境变量配置
   - 参考项目代码中的配置项自行创建

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务（前后端同时启动）
pnpm dev

# 前端单独启动
pnpm dev:client

# 后端单独启动
pnpm dev:server
```

> 注意：本项目使用 pnpm workspace 管理，请确保已安装 pnpm。
