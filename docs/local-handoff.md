# 转到 Windows 本地开发

2026-10-12。用户决定停止继续在云端开发，转到客户端本地。云端保存当前代码后结束开发；此文档和启动脚本不代表已在用户电脑执行。

## 取得当前开发版本

保留原目录 `D:\works\workbuddy\meetingOS`，不要覆盖它。当前工程在 `feat/meeting-workbench`，不要下载仍为历史备份的 main 分支。

在电脑 PowerShell 执行（需要 Git 与 Node.js 24+）：

```powershell
git clone --branch feat/meeting-workbench https://github.com/nbchenzheng/meetingOS.git D:\works\workbuddy\meetingOS-dev
cd D:\works\workbuddy\meetingOS-dev
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local-dev.ps1 -CredentialFile (Read-Host '输入 key.txt 的完整路径')
```

最后一条只在该 PowerShell 子进程使用脚本执行策略，不修改系统执行策略。把 key.txt 路径改成文档实际位置，放在仓库外；不需要再次上传。若 meetingOS-dev 已存在，先检查其中改动，不要覆盖或删除；换一个空目录克隆。

脚本首次安装锁定依赖，启动 Node API 与 Vite。浏览器打开 `http://127.0.0.1:5173`。端口被占用可追加 `-ApiPort 3032 -WebPort 5174`；不停止其他项目进程。凭证只载入进程环境，停止后恢复原环境；会议数据在 `%LOCALAPPDATA%\MeetingOS\development`，不混入旧项目或 Git。

没有 key.txt 时可省略 CredentialFile，通过本地受保护环境变量配置。文件格式为 URL 一行、对应 Key 下一行。脚本不执行文件中的文本，不输出 Key。阿里云文档中的 compatible-mode LLM URL 仅用来辨识其凭证，不作为 ASR 地址；ASR 实际使用 DashScope WebSocket。

## 在客户端接续开发

在 Codex 客户端选择 **本地环境**，打开 `D:\works\workbuddy\meetingOS-dev`，然后发送：

> 按 AGENTS.md 和 docs/local-handoff.md 接续 MeetingOS 开发。已授权按既定设计方案自主推进。LinkHarbor 仅用于 GPT、Claude、Gemini；wei.run 用 DeepSeek v4 Flash；阿里百炼用于 ASR。优先完成多人同会权限、长会议上下文和离线可靠保存。保留历史快照，不部署生产、不修改其他服务器项目。

云端会话没有访问 Windows 本机磁盘或切换客户端环境的工具，因此必须由客户端选择本地目录，之后的新会话才能实际在电脑上修改和运行代码。

## 接续时必须了解

- 当前工作台、账号隔离、令牌、SQLite/SSE、客户投影、私有附件、范围选择与删除、会议结束和自动建议已实现。
- 本轮新增直接 DeepSeek 与 Gemini 入口；新会议默认 DeepSeek Flash。所有思维视角也走 wei.run。未迁移旧会议选中的模型，避免改写用户记录；旧会若需降低开销，请在选择器切换 DeepSeek。
- 不允许 DeepSeek 从 wei.run 回退到 LinkHarbor。WEI_LLM_API_KEY/WEI_LLM_BASE_URL 是独立配置，旧 DEEPSEEK_API_KEY/DEEPSEEK_BASE_URL 不再控制当前工作台路由。
- LinkHarbor 的 GPT/Claude 已做真实合成输入测试，Gemini 仅验证了模型目录/路由，未做真实推理验收。先前通过 LinkHarbor 测 DeepSeek 的记录是历史验证，不是当前方案。
- 阿里云凭证通过真实 ASR task-started 握手，尚未验证真人中文识别效果；WebSocket 已修正为使用 Node24 原生代理 Agent。wei.run 模型目录鉴权成功，当前分工下的真实推理留到本地验证。
- 运行 `npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build`。新增路由测试使用两个独立受控网关，检查日常模型、国外三模型、不跨网关兜底；ASR 测试使用本地假服务器，不能冒充真实识别质量验收。
- 下一阶段：多人同会成员权限，长会议检索/压缩，离线幂等队列；后续再做 Agent 双向同步与旧数据迁移。用户已授权开发，不重复询问设计方向。
- 生产部署、SSH 暂停。凭证、真实会议、上传、音频、令牌不得进入提交；历史 source-snapshots 的字节保持原样。
