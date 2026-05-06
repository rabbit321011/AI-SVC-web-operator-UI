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

## AI 服务接入说明

本项目是 **本地 AI 推理服务** 的前端操作界面，SVC（歌声转换）功能通过后端 `spawn` Python 进程调用本地部署的 AI 模型来完成。**不是对接云端 API**。

### 架构概览

```
┌─────────────────────────────────────────────────────────┐
│  前端 (client/)                                          │
│  Vue 3 + Vite                                            │
│  用户选择音轨片段 → 配置 SVC 参数 → 发起推理              │
└────────────────┬────────────────────────────────────────┘
                 │ HTTP + WebSocket
┌────────────────▼────────────────────────────────────────┐
│  后端 (server/)                                          │
│  Express + TypeScript                                    │
│  spawn Python 子进程，通过 WebSocket 推送推理进度          │
│  脚本：server/scripts/svc_runner.py                      │
│  脚本：server/scripts/f0_extract.py                      │
└────────────────┬────────────────────────────────────────┘
                 │ child_process.spawn()
┌────────────────▼────────────────────────────────────────┐
│  AI 模型 (本地部署)                                       │
│  YingMusic-SVC（基于 Seed-VC 的歌声转换模型）              │
│  Python 虚拟环境 + PyTorch + CUDA                        │
└─────────────────────────────────────────────────────────┘
```

### 依赖的外部仓库

本项目运行需要以下外部仓库部署在同一台机器上：

| 仓库 | 用途 | 地址 |
|------|------|------|
| **YingMusic-SVC** | AI 推理模型（上游） | [GiantAILab/YingMusic-SVC](https://github.com/GiantAILab/YingMusic-SVC) |
| **YingMusic-SVC-fine-tune** | 微调后的模型权重与配置（fork） | [rabbit321011/YingMusic-SVC-fine-tune](https://github.com/rabbit321011/YingMusic-SVC-fine-tune) |

### 硬编码路径清单

当前代码中有以下硬编码的本地绝对路径，**部署到其他机器时必须修改**：

| 文件 | 路径 | 说明 |
|------|------|------|
| `server/src/services/svc.service.ts` | `E:/AIscene/AISVCs/.venv/Scripts/python.exe` | Python 虚拟环境解释器 |
| `server/src/services/svc.service.ts` | `E:/AIscene/AISVCs/YingMusic-SVC` | YingMusic-SVC 模型仓库目录 |
| `server/src/services/svc.service.ts` | `E:/AIscene/AISVCs/YingMusic-SVC/outputs` | 推理结果输出目录 |
| `server/scripts/svc_runner.py` | `E:/AIscene/AISVCs/YingMusic-SVC` | 同上，Python 脚本中 |
| `server/scripts/svc_runner.py` | `E:/AIscene/AISVCs/temp/temp_0502` | 临时输出模型目录 |
| `server/src/index.ts` | `E:/AIscene/AISVCs/.venv/Scripts/python.exe` | F0 提取用的 Python 路径 |
| `client/src/stores/svcConfig.ts` | `E:/AIscene/AISVCs/temp/temp_0502/output_models/...` | 模型 checkpoint 路径 |
| `client/src/stores/svcConfig.ts` | `E:/AIscene/AISVCs/YingMusic_fork/花丸-平-voice.mp3` | 目标音色参考音频 |
| `client/src/stores/svcConfig.ts` | `E:/AIscene/AISVCs/YingMusic-SVC/configs/YingMusic-SVC.yml` | 模型配置文件 |

> **建议**：将这些路径改为通过 `.env` 环境变量或配置文件读取，避免硬编码。

### 部署前置条件

1. 克隆 [YingMusic-SVC](https://github.com/GiantAILab/YingMusic-SVC) 到本地
2. 克隆 [YingMusic-SVC-fine-tune](https://github.com/rabbit321011/YingMusic-SVC-fine-tune)（微调权重）到本地
3. 创建 Python 虚拟环境并安装 YingMusic-SVC 的依赖（PyTorch、torchaudio、soundfile 等）
4. 下载预训练模型权重并放入对应目录
5. 修改上述硬编码路径为本机实际路径
