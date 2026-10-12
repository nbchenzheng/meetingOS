# 大咖萃取内容（dossiers）

本目录用于存放 20 位大咖的「萃取内容」（思想体系 / 决策框架 / 代表观点 / 金句）。

## 当前状态：待接入（架构 T11 预留接口）

在拿到 clawharbor 的 GitHub 仓库后，将每位大咖的几千字萃取内容写入 `<id>.md`，并在角色数据里通过 `dossier` 字段引用（值为该 md 的文本内容或路径）。

`board-service.assemblePrompt` 当前优先使用 `dossier` 字段；若为空则回退到角色的 `persona + focus` 文本，保证系统先跑通。等待接入期间请勿提交真实萃取内容。
