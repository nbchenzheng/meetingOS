# MeetingOS SSH 与后续发布准备

## 已确认的连接

用户电脑的 `Test-NetConnection 101.35.232.194 -Port 22` 返回 True，并且 `ssh ubuntu@101.35.232.194 -p 22` 已成功登录。服务器云防火墙允许 TCP 22。

当前 Codex 云任务直连该端口仍被拒绝；HTTP CONNECT 代理返回 200 后没有收到 SSH 握手。保存域名网络草稿不等于开放原生 SSH TCP。该云任务未直接登录服务器，未实施部署。

可在 Codex 本地执行环境复用用户已验证的 SSH 连接。仓库另提供由 GitHub 托管 runner 执行的手动 SSH 检查，作为后续发布的候选路径；必须实际运行成功后才能确认 runner 的连通性和认证。

## 专用密钥

在有已验证 SSH 连接的本地机器生成专用 Ed25519 密钥，私钥留在受保护位置，公钥追加到 **ubuntu** 的 `~/.ssh/authorized_keys`，保留已有公钥。不要把私钥、密码或 `.env` 加入 Git 或聊天。

Windows PowerShell 示例（如果文件已存在，先核实并复用，避免覆盖）：

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\meetingOS_deploy" -C meetingOS-github-actions
```

该检查工作流直接使用 SSH 密钥文件，未配置密码解锁；CI 专用密钥需使用空口令，并存入 GitHub Actions 受保护的 Secret。

从本地将公钥追加到 ubuntu 的 SSH 授权文件：

```powershell
Get-Content "$env:USERPROFILE\.ssh\meetingOS_deploy.pub" | ssh ubuntu@101.35.232.194 -p 22 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys'
```

随后验证密钥登录。首次遇到主机公钥时，与服务器控制台中取得的公钥核对；不要关闭主机身份校验：

```powershell
ssh -i "$env:USERPROFILE\.ssh\meetingOS_deploy" -o IdentitiesOnly=yes ubuntu@101.35.232.194 -p 22
```

需要固定别名时，可参考 `ssh-meeting.conf.example`，然后使用 `ssh meetingos` 和 `scp`。密钥生成、安装和免密登录尚未由当前云任务执行或验证。

## 手动 GitHub Actions 检查

在仓库 Actions Secrets 配置：

| Secret | 内容 |
|---|---|
| `MEETING_SSH_PRIVATE_KEY` | 上述专用私钥文件的完整内容 |
| `MEETING_SSH_KNOWN_HOSTS` | 从可信服务器控制台取得的主机公钥，格式为 `101.35.232.194 ssh-ed25519 公钥内容` |

在已信任的服务器控制台取得主机公钥行，只读取公钥文件：

```bash
awk '{print "101.35.232.194 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

如果本地已有可用的 GitHub CLI 登录，可通过 stdin 安全设置私钥，不把私钥输出到终端：

```powershell
Get-Content -Raw "$env:USERPROFILE\.ssh\meetingOS_deploy" | gh secret set MEETING_SSH_PRIVATE_KEY --repo nbchenzheng/meetingOS
```

主机公钥行可直接填入对应 Secret。设置后，在仓库 Actions 选择 **MeetingOS SSH check**，手动运行。工作流要求 BatchMode、指定身份文件和严格主机身份校验，临时私钥文件在任务退出时清理。

成功判据是 SSH 登录成功、账号为 ubuntu、能读取 `/opt/aiboard/package.json` 和 `server/api-server.mjs`，并返回 Node 版本。该检查未运行；没有 Secret 时会明确失败，不会跳过检查并报告成功。

## 后续部署边界

目前只添加了连接检查。产品改造方案尚未确定，前端可编辑源码也未取回。后续部署前，需要确认真正管理会议进程的方式和服务名、备份恢复步骤、ubuntu 对会议目录和该服务的必要权限，并实际验证连接。

发布只操作 `/opt/aiboard`，保留生产 `.env` 和业务数据，只重启已核实的会议服务。现有服务器有其他网站，不覆盖 Nginx 全局配置，不停止其他进程，不修改共享防火墙或 SSH 服务。
