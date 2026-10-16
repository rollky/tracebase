# Tracebase

从本地代码和参考文档建立可追溯的业务知识库。桌面端使用 Electron + React，面向 macOS 与 Windows；浏览器模式用于界面预览。

## 启动

需要 Node.js 22.13+ 和 npm。源代码目录中的 SVN/Git 为可选能力：如果无法使用版本命令，则回退到文件快照并明确提示，不会修改或提交源码。

```sh
npm install
npm start
```

`npm start` 先构建界面，再打开桌面应用。无需 Rust、Python、Word 或 PDF 阅读器。

如果 Electron 二进制未自动下载，执行 `node node_modules/electron/install.js`。受限网络可将官方发布的对应平台 zip 下载到本机，再使用 `scripts/install-electron-zip.mjs`；此脚本必须通过 npm 包内官方 SHA256 校验才会解压。

仅看界面：

```sh
npm run dev
```

浏览器打开 http://127.0.0.1:5173。预览模式使用明确标记的虚构数据；支持页面切换、编辑、搜索、项目创建和示例 Markdown 下载，不会保存密钥、读取本地目录或发送模型请求。桌面端初次启动为空工作区，不自动填充虚构知识。

## 使用流程

1. 创建项目。在「资料来源」选择 SVN/Git 工作副本、普通目录或参考文档。
2. 扫描，查看被排除的文件和版本提示。
3. 在「模型与 API Key」选择服务或填写兼容接口地址、模型名称、API Key。内置 DeepSeek、通义千问、本地模型配置预设；具体可用模型以账号开通情况为准。测试连接会发出一条短模型请求。
4. 筛选一个业务流程涉及的文件，勾选后点击「分析所选资料」。确认服务地址、批次数量和文件范围后开始。
5. 在任务页观察进度，可停止任务。已经完成的草稿会保留；程序重启后未完成任务标为中断，当前版本需要重新选择剩余范围发起任务。
6. 在知识库查看正文和代码/文档依据，人工编辑并核对。引用位置通过检查，并不证明业务推理正确。
7. 导出 Markdown 或发布飞书新文档。随后代码更新时重新扫描，引用变化文件的条目会标为「来源已变化」。重新分析生成新草稿，旧条目保留供比较。

## 已实现

- 多项目工作区、资料添加和移除、本地持久化、项目切换。
- SVN 本地 info/status、混合版本记录；Git 跟踪文件；普通目录扫描。不会执行 update/checkout/commit。
- 常见源码、UTF-8 文本、Markdown、CSV、JSON、XML、HTML、PDF、DOCX；PDF 扫描件明确提示需要 OCR。
- 依赖/构建目录与常见凭据文件排除；文件哈希；边界校验；扫描遗漏原因。
- 限量分批分析（每批约 24,000 字符，最多 30 批）；模型结果结构检查、引用 ID/行范围验证；草稿与人工确认状态区分。
- 任务进度、失败原因、停止、已完成批次保存；变更文件筛选和受影响知识提示。
- 正文搜索、领域导航、待确认问题汇总、来源查看、正文编辑、最近 20 次手动修改历史。
- Chat Completions 兼容模型；仅 HTTPS 远程接口，允许 localhost HTTP；主进程发请求，渲染进程不持有已保存 Key。
- 系统安全存储加密密钥；原子写入工作区；隔离渲染进程、沙箱、严格 IPC 方法白名单、CSP。
- Markdown 导出；飞书应用身份验证与新建文档发布；部分发布失败保留文档链接，避免误报成功。
- 中文界面、键盘焦点、弹窗焦点限制、窄窗口适配、减少动画偏好。

## 边界与后续版本

- 当前是 0.1 开发版，不是已签名的正式发行包。macOS 与 Windows 共用代码，但需要各平台实际构建和验收。
- 目前通过用户选定的文件进行业务分析，没有 AST 调用图、自动追踪补读、多仓库联合推理、后台定时扫描、问答检索或自动去重合并。
- 资料正文默认不持久化；索引、业务条目、来源元数据与任务保存在 JSON 工作区中。SQLite/FTS 是后续迁移项，不宣称当前已使用。
- 当前不支持飞书在线资料导入、知识空间节点同步、双向同步、OAuth 登录和富文本 Markdown 转换。飞书发布将 Markdown 内容作为普通段落保留，单次发布一个条目到新文档，不覆盖已有文档。
- 飞书需要自建应用 App ID、App Secret，具备文档创建/编辑权限，并向应用授权目标文件夹。模型 API Key 与飞书应用凭据互不通用。
- PDF/Word 的引用行号指提取后的文本位置，PDF 文本包含页码标记；不是 Word 原页面的版式行号。仅支持 UTF-8 源码，旧 GBK 项目需要先转换副本编码。
- 文件名排除只是基本过滤，不是完整 DLP。源码与文档内仍可能有敏感内容；发送前的范围确认展示本次文件列表和服务地址。
- 自建兼容接口未必完全支持 `max_tokens` 和 Chat Completions 响应结构；原生 Anthropic/Gemini API 尚未适配。
- 对依赖代码/配置未选入本次分析的情况，模型应记录为待确认。业务正确性需人工核对，不提供虚假的置信度评分。

## 数据位置

使用 Electron `app.getPath('userData')`：通常 macOS 为 `~/Library/Application Support/Tracebase`，Windows 为 `%APPDATA%/Tracebase`。

- `workspace.json`：项目、模型地址与名称（无 Key）、索引、知识、任务、发布记录。
- `secrets.json`：通过 Electron safeStorage 加密的密钥，不能作为跨电脑通用配置复制。

请备份 `workspace.json`；换机后重新配置密钥。当前无需账户、遥测或远程数据库。退出应用会中止正在执行的任务，已保存内容保留。

## 构建安装包

macOS 上：

```sh
npm run package:mac
```

Windows 上：

```sh
npm run package:win
```

产物在 `release/`。开发阶段为未签名构建；正式分发需要配置各平台代码签名及 macOS 公证。Mac 构建架构默认跟随 Node 进程，可用 electron-builder 的 `--arm64` / `--x64` 显式指定。Windows 安装程序可选择目录。无需在用户电脑安装 Node，只有开发/构建环境需要。

## Kimi 模型

在「设置 → 模型配置」选择 **Kimi / Moonshot**，填写 Kimi 开放平台 API Key，再选择模型。默认接口为 `https://api.moonshot.cn/v1`，也可以编辑为自己的兼容网关。预置 Kimi K3、K2.7 Code / Highspeed 和 K2.6，支持手动填写其他模型 ID。应用按模型系列调整推理参数；连接测试也会消耗少量 API 额度。密钥仅保存在本机系统加密存储中，不写入代码库。

## GitHub 自动构建与发行

`.github/workflows/release.yml` 在提交到 `main`、提交 PR 或手动运行时自动测试并构建：

- macOS Apple Silicon：DMG、ZIP
- macOS Intel：DMG、ZIP
- Windows x64：EXE 安装程序

普通构建的安装包在 Actions 的 Artifacts 中保留 14 天。推送与 `package.json` 版本对应的标签（例如 `v0.1.0`）会自动创建 GitHub Release，并附上安装包和 SHA256 校验文件。也可以打开 Actions → Build desktop releases → Run workflow，填写 `release_tag` 为 `v0.1.0`；留空则仅构建。发布前请更新 package.json 及 package-lock.json 的版本号。

工作流使用 GitHub 内置令牌，无需提供个人 Token 或模型 Key。当前为未签名开发版本，没有配置 Apple 公证或 Windows 代码签名；系统可能显示安全提示。私有仓库的运行资源受 GitHub 账户 Actions 额度限制。

## 验证命令

```sh
npm test
npm run build
# 先启动 npm run dev；需要 Google Chrome
node scripts/ui-smoke.mjs
# 需要已安装 Electron；使用隔离临时数据目录和本机模拟模型服务
node scripts/desktop-smoke.mjs
```

核心测试覆盖扫描排除规则、路径越界、SVN 混合版本、Word/PDF 提取、分块完整性、引用校验、接口错误、任务生成/取消、持久化、变更失效与飞书部分发布。模拟接口测试不等于真实模型/飞书账号联调。

## 项目结构

```text
core/       扫描、解析、模型、任务、存储和发布逻辑
electron/   桌面窗口、原生选择器、安全存储、IPC
src/        React 界面、组件、样式与隔离的预览适配器
fixtures/   可以直接扫描的虚构订单项目
tests/      核心逻辑自动测试
scripts/    浏览器与桌面冒烟测试、离线运行时安装
```

视觉使用深蓝灰框架、浅色阅读区和琥珀色证据轨迹。源代码与业务正文在界面上以文本渲染，不执行资料中的 HTML/脚本。
