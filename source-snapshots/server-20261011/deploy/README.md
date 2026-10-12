# AI 大咖会议私董会 · 部署手册

> 单进程全栈部署：Node 后端（`server/api-server.mjs`）在生产模式下会**同时托管前端静态资源（`out/`）和 API / WebSocket**，无需单独的静态服务器。

## 0. 这个包里有什么

```
aiboard-deploy.tar.gz
├── out/                 # 已构建的前端（Vite 产物，勿改）
├── server/              # Node ESM 后端（api + 实时转写 WS）
├── dossiers/            # 22 位大咖思想萃取（claude / gpt55 / 20 位真人）
├── package.json         # 依赖声明
├── package-lock.json    # 锁定版本
├── .env.example         # 密钥模板（复制为 .env 并填值）
└── deploy/
    ├── README.md        # 本文件
    ├── start.sh         # 生产启动脚本
    ├── aiboard.service  # systemd 单元（开机自启 / 进程守护）
    └── nginx-meeting.conf  # 反代 + HTTPS（可选，推荐）
```

## 1. 服务器前置条件

- 操作系统：Linux（TencentOS / Ubuntu / Debian 均可）
- Node.js ≥ 18（推荐 20 LTS）。验证：`node -v`
- 包管理：`npm`
- （可选，用于域名 HTTPS）nginx + certbot

## 2. 上传到服务器

在你**能连上服务器**的机器上执行（本机无法直接推送，见文末说明）：

```bash
scp aiboard-deploy.tar.gz root@meeting.weispace.cloud:/opt/
ssh root@meeting.weispace.cloud
```

## 3. 在服务器上解压并安装依赖

```bash
mkdir -p /opt/aiboard && cd /opt/aiboard
tar -xzf /opt/aiboard-deploy.tar.gz -C /opt/aiboard
npm install --omit=dev        # 仅装运行时依赖（ws 等），很快
```

## 4. 配置密钥（重要，切勿提交 .env）

```bash
cp .env.example .env
vi .env                       # 填入以下真实值
```

`.env` 必填项：

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | 大咖发言用的 DeepSeek 密钥 |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com/v1` |
| `LINKHARBOR_API_KEY` | Claude / GPT-5.5 路由密钥 |
| `LINKHARBOR_BASE_URL` | 默认 `https://api.linkharbor.ai/v1` |
| `ALIYUN_ASR_API_KEY` | 阿里云实时语音密钥（留空则前端自动回退浏览器 Web Speech） |
| `ALIYUN_ASR_APP_KEY` | 阿里云 APP KEY |
| `ALIYUN_ASR_REGION` | 默认 `cn-shanghai` |
| `PORT` | 后端端口，默认 `3001` |

> 阿里云 ASR 不填也能跑：前端会自动切换为浏览器原生语音识别（Web Speech API，需 Chrome 且 https 环境）。

## 5. 启动

### 方式 A：直接前台 / nohup（最快验证）

```bash
bash deploy/start.sh
# 或后台常驻：
nohup bash deploy/start.sh > /opt/aiboard/runtime.log 2>&1 &
```

### 方式 B：systemd（推荐，开机自启 + 崩溃重启）

```bash
cp deploy/aiboard.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now aiboard
journalctl -u aiboard -f    # 看日志
```

## 6.（推荐）nginx 反代 + Let's Encrypt HTTPS

没有 HTTPS 时麦克风 API 与 Web Speech 在多数浏览器会被禁用。配置域名 `meeting.weispace.cloud`：

```bash
cp deploy/nginx-meeting.conf /etc/nginx/conf.d/meeting.conf
nginx -t && systemctl reload nginx
# 申请证书（需 80 端口已开、域名已解析到本机）
certbot --nginx -d meeting.weispace.cloud
```

如需让 nginx 直接托管静态资源（更高性能），把 `nginx-meeting.conf` 里 `location /` 改为：
```
root /opt/aiboard/out;
try_files $uri $uri/ /index.html;
```
并仅反代 `/api/` 与 `/ws/`。

## 7. 防火墙 / 安全组

- 仅用 nginx：开放 **80 / 443**，后端 3001 只对本地监听（默认已绑定 0.0.0.0，可改 `127.0.0.1`）。
- 不用 nginx 直接裸跑：开放 **3001**。

## 8. 验证

```bash
curl -s http://localhost:3001/api/health      # 应返回 {"ok":true,...}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/   # 应 200
curl -s http://localhost:3001/api/roles | grep -o '"cn"' | wc -l  # 应 22
```
浏览器访问 `https://meeting.weispace.cloud` → 进入「会议筹备」→ 逐个点击加入大咖 → 开始会议。

## 9. 常见问题

- **发言一直转圈 / 返回本地兜底**：检查 `DEEPSEEK_API_KEY` / `LINKHARBOR_API_KEY` 是否填对；看 `runtime.log` 有无 `ReferenceError`。
- **麦克风没反应**：必须是 **https** 环境；阿里云模式需 `ALIYUN_ASR_API_KEY` 已配，否则自动走 Web Speech。
- **大咖说话声音不像本人**：确认 `dossiers/` 已随包上传；`/api/roles` 里每位应有非空 `dossier`。
- **数据存哪**：会议数据在 `server/data/`（运行时生成，已被排除在包外）；迁移时一并拷贝即可。

---
> 安全提示：`.env` 含密钥，已刻意排除在部署包外，请勿 `git add` 或公开分享。
