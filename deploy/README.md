# 新工作台的发布前提

当前开发版需要 Node.js 24+，请先在独立测试目录执行根目录 README 中的安装、测试与构建。此版本使用新的鉴权 API 和独立 meetingos.sqlite；旧数据库、培训模块、旧路由不自动迁移。原部署说明完整保留在 `source-snapshots/server-20261011/deploy/README.md`。

生产发布尚未执行，SSH 仍按用户要求暂停。未来发布先验证真实模型/语音、邀请码、HTTPS来源、账号权限、数据迁移与回滚，只操作会议项目；不能用模板覆盖同机共享 Nginx 配置。

构建输出 out/ 是生成产物，运行入口是 `server/api-server.mjs`。`deploy/start.sh` 只启动本项目；systemd/Nginx 文件是历史参考，使用前需要按实际部署重新检查。
