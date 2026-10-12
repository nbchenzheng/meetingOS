# MeetingOS 接续开发

先读 `docs/local-handoff.md`、`docs/implementation-plan.md`、`docs/design/research-and-decision-20261012.md`，并检查 Git 状态。

用户决定在 Windows 本地环境继续开发。不要把云端完成的检查称为已在 Windows 运行；不要访问其他站点或恢复暂停的 SSH/生产部署。

用户已授权按既定方案继续实施，不重复询问设计选择。模型分工：LinkHarbor 仅用于 GPT、Claude、Gemini；日常及所有思维视角使用 wei.run DeepSeek v4 Flash；阿里百炼用于 ASR。禁止日常模型失败后静默调用昂贵网关。

使用 Node24+、锁定 npm 安装。针对变更验证 API/权限/持久化与实际浏览器流程。保存原有用户改动及两个历史源码快照。凭证只读取用户明确提供的受保护配置，不输出、不提交。无需创建额外 worktree，除非用户明确要求。
