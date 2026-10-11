#!/usr/bin/env python3
# 只读诊断（不改动任何配置/文件）
import os, sys, paramiko
HOST="101.35.232.194"; USER="root"; PASS=os.environ.get("AI_PASS","")
def connect():
    c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST,username=USER,password=PASS,timeout=25,look_for_keys=False,allow_agent=False)
    return c
def run(c,cmd):
    stdin,stdout,stderr=c.exec_command(cmd,timeout=60)
    return stdout.read().decode(errors="replace"), stderr.read().decode(errors="replace")
c=connect()
checks=[
 ("=== aiboard 服务状态 ===","systemctl status aiboard --no-pager -l 2>&1 | head -20"),
 ("=== aiboard 日志(最近30行) ===","journalctl -u aiboard -n 30 --no-pager 2>&1"),
 ("=== node 进程 ===","ps aux | grep -E 'api-server|node' | grep -v grep"),
 ("=== 端口监听(80/443/3001) ===","ss -tlnp 2>/dev/null | grep -E ':80 |:443 |:3001 ' || echo 'ss-none'"),
 ("=== nginx 服务状态 ===","systemctl status nginx --no-pager -l 2>&1 | head -15"),
 ("=== nginx 日志(最近20行) ===","journalctl -u nginx -n 20 --no-pager 2>&1"),
 ("=== nginx 配置目录 ===","echo 'conf.d:'; ls -1 /etc/nginx/conf.d/ 2>&1; echo 'sites-enabled:'; ls -1 /etc/nginx/sites-enabled/ 2>&1; echo 'sites-available:'; ls -1 /etc/nginx/sites-available/ 2>&1"),
 ("=== 本机80连通性 ===","curl -s -m 5 -o /dev/null -w 'localhost:80 -> %{http_code}\\n' http://127.0.0.1:80/ 2>&1"),
 ("=== 本机3001连通性 ===","curl -s -m 5 -o /dev/null -w 'localhost:3001 -> %{http_code}\\n' http://127.0.0.1:3001/ 2>&1; curl -s -m 5 http://127.0.0.1:3001/api/health 2>&1 | head -c 400"),
]
for label,cmd in checks:
    out,err=run(c,cmd)
    print(label); print(out.strip()); 
    if err.strip(): print("ERR:",err.strip())
    print()
c.close()
