#!/usr/bin/env python3
# AI Board 部署脚本（paramiko，密码从环境变量 AI_PASS 读取，绝不明文落盘）
# 用法：
#   AI_PASS='...' python _deploy_remote.py check
#   AI_PASS='...' python _deploy_remote.py deploy
import os, sys, json, paramiko

HOST = "101.35.232.194"
USER = "root"
PASS = os.environ.get("AI_PASS", "")
LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))
TARBALL = os.path.join(LOCAL_DIR, "..", "aiboard-deploy.tar.gz")
LOCAL_ENV = os.path.join(LOCAL_DIR, "..", ".env")
SERVICE = os.path.join(LOCAL_DIR, "aiboard.service")
NGINX = os.path.join(LOCAL_DIR, "aiboard.http.conf")
REMOTE_TARBALL = "/opt/aiboard-deploy.tar.gz"
REMOTE_DIR = "/opt/aiboard"


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=25,
              look_for_keys=False, allow_agent=False)
    c.get_transport().set_keepalive(30)
    return c


def run(c, cmd, timeout=300):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def sftp_put(c, local, remote):
    sftp = c.open_sftp()
    try:
        sftp.put(local, remote)
    finally:
        sftp.close()


def check():
    c = connect()
    print("=== 服务器环境盘点 ===")
    for label, cmd in [
        ("OS", "cat /etc/os-release 2>/dev/null | head -3"),
        ("node", "node -v 2>&1; which node 2>&1"),
        ("npm", "npm -v 2>&1; which npm 2>&1"),
        ("nginx", "nginx -v 2>&1; which nginx 2>&1"),
        ("systemctl", "which systemctl 2>&1; systemctl --version 2>&1 | head -1"),
        ("tools", "which curl tar 2>&1"),
        ("disk", "df -h /opt 2>&1 | tail -1"),
        ("existing", "ls -la /opt/aiboard 2>&1 | head -3"),
    ]:
        rc, out, err = run(c, f"echo '--- {label} ---'; {cmd}")
        print(out.strip())
        if err.strip():
            print("ERR:", err.strip())
    c.close()


def deploy():
    c = connect()
    print("=== 1/7 上传部署包 ===")
    sftp_put(c, TARBALL, REMOTE_TARBALL)
    print("tarball uploaded ->", REMOTE_TARBALL)

    print("=== 2/7 解压到 /opt/aiboard ===")
    rc, out, err = run(c, f"rm -rf {REMOTE_DIR} && mkdir -p {REMOTE_DIR} && tar -xzf {REMOTE_TARBALL} -C {REMOTE_DIR} && echo EXTRACTED && ls {REMOTE_DIR}")
    print(out.strip()); print("ERR:", err.strip())

    print("=== 3/7 安装后端依赖 (npm ci --omit=dev) ===")
    rc, out, err = run(c, f"cd {REMOTE_DIR} && npm ci --omit=dev 2>&1 | tail -25; echo RC=$?")
    print(out.strip()[-2000:]); print("ERR:", err.strip()[-500:])

    print("=== 4/7 写入 .env（本地直传，不回显） ===")
    sftp_put(c, LOCAL_ENV, f"{REMOTE_DIR}/.env")
    print(".env uploaded ->", f"{REMOTE_DIR}/.env")

    print("=== 5/7 配置 systemd 服务 ===")
    sftp_put(c, SERVICE, "/etc/systemd/system/aiboard.service")
    rc, out, err = run(c, "systemctl daemon-reload 2>&1; systemctl enable aiboard 2>&1; systemctl restart aiboard 2>&1; sleep 3; systemctl is-active aiboard 2>&1")
    print(out.strip()); print("ERR:", err.strip())

    print("=== 6/7 配置 nginx 反代 (HTTP) ===")
    has_nginx = run(c, "which nginx >/dev/null 2>&1 && echo YES || echo NO")[1].strip()
    print("nginx present:", has_nginx)
    if has_nginx == "YES":
        sftp_put(c, NGINX, "/etc/nginx/conf.d/aiboard.conf")
        # Ubuntu 默认站点也监听 80，会冲突，先移除
        rc, out, err = run(c, "rm -f /etc/nginx/sites-enabled/default; nginx -t 2>&1; (systemctl reload nginx 2>&1) || (systemctl restart nginx 2>&1); echo NGINX_DONE")
        print(out.strip()); print("ERR:", err.strip())
    else:
        print("nginx 未安装，跳过反代；将直接以 3001 端口对外（需安全组放行 3001）。")

    print("=== 7/7 自检 ===")
    rc, out, err = run(c, f"sleep 2; echo '--- /api/health ---'; curl -s http://localhost:3001/api/health; echo; echo '--- roles count ---'; curl -s http://localhost:3001/api/roles | python3 -c \"import sys,json; d=json.load(sys.stdin); print('ok=',d.get('ok'),'roles=',len(d.get('roles',[])))\" 2>&1; echo '--- external 3001 ---'; curl -s -m 8 http://101.35.232.194:3001/api/health 2>&1 | head -c 300; echo")
    print(out.strip()); print("ERR:", err.strip())
    c.close()
    print("=== DEPLOY SCRIPT DONE ===")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"
    if mode == "check":
        check()
    elif mode == "deploy":
        deploy()
    else:
        print("usage: check | deploy")
