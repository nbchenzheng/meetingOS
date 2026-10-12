# meetingOS

AI 大咖会议私董会的服务器部署备份，以及从本地电脑恢复的可编辑工程。两份版本分别保存，原有 LICENSE 保留。

- 仓库根目录：`meeting.weispace.cloud` 的 `/opt/aiboard` 部署快照，取回日期 2026-10-11。包含后端、角色资料、静态角色配置、依赖锁文件和线上前端发布版本。
- [source-snapshots/local-20261011/ai-board](source-snapshots/local-20261011/ai-board)：从 `D:\works\workbuddy\meetingOS` 上传的 ZIP 恢复的 React/TypeScript/Vite 工程，包含 54 个 `src` 文件，已通过构建与隔离启动检查。

**本地工程与服务器版本不同步，不能认定为线上最新版的完整源码。** 服务器版有后续持久化、接口和缓存修正，以及 3 个新增角色；本地版另有结构化纪要和来源条目设计。两份版本未合并，服务器快照的原应用文件保持不变。详细差异见 [源码恢复报告](docs/source-recovery.md)。

## 运行现有发布版本

使用 Node.js 24 和 npm，在仓库目录执行：

```bash
npm ci --omit=dev --ignore-scripts --no-audit --no-fund --cache /tmp/meetingos-npm-cache
PORT=3001 AI_BOARD_DATA_DIR=/tmp/meetingos-dev-data npm start
```

Node 同时提供 `out/` 页面、REST API 和 WebSocket。基础检查为 `GET /api/health`、`GET /api/roles`（当前 25 个角色）和主页请求。

需要真实 AI 调用时，按 `.env.example` 配置模型凭据，或从受保护的环境绑定注入。无凭据时角色发言会返回本地兜底；总结、整理等接口会降级。真实音频、国外模型和邮件发送没有在这个备份环境中验证。

## 运行恢复的可编辑工程

在 Node.js 24 环境中执行：

```bash
cd source-snapshots/local-20261011/ai-board
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/meetingos-npm-cache
npm run build
npm run dev
```

默认后端端口 3001，Vite 端口 5173。启动前停止自己启动的、占用 3001 的预览进程。Vite 代理固定指向 3001，仅修改 `PORT` 不会同时修改代理。

这份本地版提供 22 个角色，后端将数据写入它自己的 `server/data/`，不支持服务器版的 `AI_BOARD_DATA_DIR` 覆盖。验证业务流程时使用独立干净副本与合成数据。构建输出为 `out/`，不与根目录线上发布产物混用。

## 备份范围与验证限制

- 保存了 `server/*.mjs`、`dossiers/`、`deploy/`、依赖清单与锁文件、`.env.example`、`out/`。
- 静态文件 `server/data/大咖角色库.json` 来自用户回传的服务器内容，共 23 个大咖；另外两个模型角色由后端定义。
- `.env`、真实会议数据、自定义运行数据、录音、上传资料、日志、依赖目录和历史备份未提交。
- 根目录 `out/` 是服务器编译产物。服务器归档本身没有前端可编辑源码；后续恢复的本地工程可以构建，但生成的 JS/CSS 与线上不同，尚未取得与线上发布版本完全对应的前端源码。
- 本地快照保存 205 个原始源码、资源和说明文件，逐文件 SHA-256 与上传 ZIP 一致。排除了工具记忆、真实会议数据、缓存、旧编译产物与凭据文件；只保留启动必需的静态角色库。
- 导入的部署文件保留原样；其中说明的角色数和建议配置不一定与当前线上状态相同。不要直接用示例 Nginx 文件覆盖共享服务器现有配置。

服务器备份来源与验证见 [docs/backup.md](docs/backup.md)，本地工程恢复与差异见 [docs/source-recovery.md](docs/source-recovery.md)，功能分析见 [docs/product-audit.md](docs/product-audit.md)。构建和基础接口通过，不代表真实音频、模型、邮件或浏览器完整交互已经验收。

2026-10-12 已对恢复的本地版本执行实际页面与接口复测，详见 [带截图的重新测试报告](docs/product-retest-20261012.md)。记录了 23 张截图、19 个现有单测和 28 项隔离接口检查；真实音频、模型质量和邮件发送仍未验收。

## SSH 与后续部署

用户已从 Windows 成功执行 `ssh ubuntu@101.35.232.194 -p 22`。当前 Codex 云任务的 SSH 连接仍未成功；用户已决定暂缓 SSH 设置，待开发方案确定后继续。

仓库提供手动触发的 `MeetingOS SSH check` 工作流和 [SSH 设置说明](deploy/SSH.md)。工作流需要配置 GitHub Actions 的专用密钥和可信主机公钥后，再运行验证；提交工作流本身不代表已经连通。它仅验证 SSH 登录和会议文件读取权限，不执行部署或重启服务。

任何后续发布都应保留 `/opt/aiboard/.env` 和运行数据，只操作会议项目，并在用户决定产品改造方案后另行实施。
