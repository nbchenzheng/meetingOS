# meetingOS

AI 大咖会议私董会的服务器部署备份，取自 `meeting.weispace.cloud` 的 `/opt/aiboard`（2026-10-11）。后端源码、角色资料、静态角色配置、依赖锁文件和当前前端发布版本均已保存；原有 LICENSE 保留。

## 运行现有发布版本

使用 Node.js 24 和 npm，在仓库目录执行：

```bash
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
PORT=3001 AI_BOARD_DATA_DIR=/tmp/meetingos-dev-data npm start
```

Node 同时提供 `out/` 页面、REST API 和 WebSocket。基础检查为 `GET /api/health`、`GET /api/roles`（当前 25 个角色）和主页请求。

需要真实 AI 调用时，按 `.env.example` 配置模型凭据，或从受保护的环境绑定注入。无凭据时角色发言会返回本地兜底；总结、整理等接口会降级。真实音频、国外模型和邮件发送没有在这个备份环境中验证。

## 备份范围与缺失项

- 保存了 `server/*.mjs`、`dossiers/`、`deploy/`、依赖清单与锁文件、`.env.example`、`out/`。
- 静态文件 `server/data/大咖角色库.json` 来自用户回传的服务器内容，共 23 个大咖；另外两个模型角色由后端定义。
- `.env`、真实会议数据、自定义运行数据、录音、上传资料、日志、依赖目录和历史备份未提交。
- `out/` 是编译产物。备份没有前端可编辑源码、TypeScript/Vite 配置或 `scripts/dev.mjs`。当前不能完整重建前端，也不能把这个仓库称为完整开发源码。
- 导入的部署文件保留原样；其中说明的角色数和建议配置不一定与当前线上状态相同。不要直接用示例 Nginx 文件覆盖共享服务器现有配置。

备份来源与验证见 [docs/backup.md](docs/backup.md)，功能分析见 [docs/product-audit.md](docs/product-audit.md)。

## SSH 与后续部署

用户已从 Windows 成功执行 `ssh ubuntu@101.35.232.194 -p 22`。当前 Codex 云任务的 SSH 连接仍未成功。

仓库提供手动触发的 `MeetingOS SSH check` 工作流和 [SSH 设置说明](deploy/SSH.md)。工作流需要配置 GitHub Actions 的专用密钥和可信主机公钥后，再运行验证；提交工作流本身不代表已经连通。它仅验证 SSH 登录和会议文件读取权限，不执行部署或重启服务。

任何后续发布都应保留 `/opt/aiboard/.env` 和运行数据，只操作会议项目，并在用户决定产品改造方案后另行实施。
