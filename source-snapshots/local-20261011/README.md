# 本地源码快照 · 2026-10-11

来源：用户电脑 `D:\works\workbuddy\meetingOS` 上传的 `meetingOS-source.zip`。实际可编辑工程在 [ai-board/](ai-board/)，外层保留原型、资源和设计说明。

这份工程可以构建和启动，但与仓库根目录的服务器快照不同步：本地 22 个角色，服务器 25 个；持久化和纪要接口也有差异。原始源码未合并、未修改，详情见 [源码恢复报告](../../docs/source-recovery.md)。

```bash
cd ai-board
npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/meetingos-npm-cache
npm run build
npm run dev
```

使用 Node.js 24。默认后端 3001、Vite 5173；Vite 代理固定为 3001。此版后端使用自己的 `server/data/`，不支持 `AI_BOARD_DATA_DIR` 覆盖。备份只包含静态角色库；测试使用干净副本和合成数据。

工具记忆、真实会议数据、凭据、缓存和旧编译产物已排除。205 个原始文件的字节校验记录见 [清单](../../docs/evidence/local-source-manifest.json)，本说明文件为恢复后新增。
