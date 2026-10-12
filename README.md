# MeetingOS

会中计划审查与客户会谈智囊。人类使用网页，Hermes等Agent通过作用域授权和Skill参与；没有个人Agent也可以使用。

当前开发入口是仓库根目录。历史版本已分别保留在 `source-snapshots/server-20261011`（原部署91个文件）和 `source-snapshots/local-20261011`（本地恢复205个文件），两份快照保持原始字节。原服务器的前端源码未完全恢复，本轮新工作台是基于恢复工程和审计结论重新实现。

## 本地开发

需要 Node.js 24+、npm。

```bash
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/meetingos-npm-cache
npm test
npm run build
npm run dev
```

开发默认后端3001、Vite5173。两个端口可一起调整：

```bash
PORT=3168 VITE_PORT=5178 AI_BOARD_DATA_DIR=/tmp/meetingos-dev-data npm run dev
```

开发模式无需邀请码即可注册。生产模式必须设置受保护的 `MEETINGOS_INVITE_CODE`，否则关闭注册；此项目没有预设root网站账号。

构建后单进程提供页面、API与WebSocket：

```bash
PORT=3168 AI_BOARD_DATA_DIR=/tmp/meetingos-dev-data npm start
```

`GET /api/health`应返回ok，未登录访问`/api/v1/meetings`应返回401。`out/`是可重建产物，不再作为当前源码提交；原服务器的out完整保留在历史快照。

## 已实现

- 按账号保存/恢复会议，原始记录不按200条裁切；修订保留原文并检测并发版本。
- 内部/客户两个模式、上传资料与原文件保存、实时记录、人工/自动建议、引用依据、人工确认决定、总结和导出。
- 人类Cookie、Agent可撤销/到期/限定会议与权限的令牌，同一变化流即时同步。
- 客户展示和共享导出在服务器排除私有约束/建议与历史敏感元数据。
- 桌面双栏、手机页签、键盘可用的表单和弹窗。

模型凭据从受保护环境或未提交的`.env`读取，模板见`.env.example`。真实可用的模型ID通过`MEETINGOS_GPT_MODEL`等配置；旧默认型号没有经过本轮真实网关验证。未配置模型或请求失败时明确报错，不用模板冒充AI。

浏览器转写可能调用浏览器厂商的网络服务，不能称为完全本地处理；云端ASR可选。发言人需手动指定，收音过程中暂停后才能切换。收音只采集本设备麦克风，系统音频、真实识别准确率、说话人自动区分尚未验收。

## Agent 接入

登录 → Agent接入 → 选择权限/会议/有效期 → 创建授权 → 把令牌存入Agent受保护环境 → 安装 [MeetingOS Skill](skills/meetingos/SKILL.md)。令牌仅创建时显示，不能放在聊天、URL或Git中。

接口说明见 [API与数据边界](docs/platform-api.md)。Agent可下载导出保存到自己的存储；本版没有自动双向镜像或完整OAuth/MCP服务。会议按账号隔离，尚未实现组织成员共享。

## 设计与验证

- [尽调与方案](docs/design/research-and-decision-20261012.md)
- [执行记录](docs/implementation-plan.md)
- [验证报告](docs/implementation-validation-20261012.md)
- [视觉与交互QA](design-qa.md)
- [原版本复测](docs/product-retest-20261012.md)
- [源码恢复](docs/source-recovery.md)

`npm test`只验证当前平台，旧版本的测试结论见复测报告。浏览器受控测试使用 `node scripts/browser-fixture.mjs` 和 `scripts/browser-smoke.py`；后者需要Python Playwright及Chromium CDP，详见验证报告。

## 数据和发布

新数据位于`AI_BOARD_DATA_DIR/meetingos.sqlite`，未设置时在`server/data/`；旧`meetings.json`和培训数据库不自动迁移/覆盖。数据库含会议、修订、附件原件及授权哈希，应放在持久、受保护的目录并备份。模型请求限额与数据保存是两回事。

本轮仅在开发分支工作，没有部署生产。SSH设置仍暂停；[SSH说明](deploy/SSH.md)只是此前保留的说明。后续发布必须先验证Node24、HTTPS来源设置、邀请码、模型、数据迁移与回滚，只操作会议项目，不覆盖共享Nginx或其他站点配置。
