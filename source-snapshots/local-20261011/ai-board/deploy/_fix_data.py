#!/usr/bin/env python3
# 修复：补传 server/data/ 到服务器（之前被误排除），重启服务并验证
import os, paramiko
HOST="101.35.232.194"; USER="root"; PASS=os.environ.get("AI_PASS","")
LOCAL=os.path.dirname(os.path.abspath(__file__))
DATA_DIR=os.path.join(LOCAL,"..","server","data")
FILES=["大咖角色库.json","meetings.json"]
REMOTE="/opt/aiboard/server/data"

def connect():
    c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST,username=USER,password=PASS,timeout=25,look_for_keys=False,allow_agent=False)
    c.get_transport().set_keepalive(30); return c

c=connect()
c.exec_command(f"mkdir -p {REMOTE}")
sftp=c.open_sftp()
for f in FILES:
    local=os.path.join(DATA_DIR,f)
    remote=REMOTE+"/"+f
    sftp.put(local,remote)
    print("uploaded", f)
sftp.close()

# 重启服务
print("=== restart aiboard ===")
_,out,err=c.exec_command("systemctl restart aiboard 2>&1; sleep 4; echo 'active='$(systemctl is-active aiboard)")
print(out.read().decode(errors="replace").strip()); print("ERR:",err.read().decode(errors="replace").strip())

# 验证
print("=== verify ===")
_,out,err=c.exec_command("echo '--- health ---'; curl -s -m 5 http://127.0.0.1:3001/api/health; echo; echo '--- roles ---'; curl -s -m 5 http://127.0.0.1:3001/api/roles | python3 -c \"import sys,json;d=json.load(sys.stdin);print('ok=',d.get('ok'),'roles=',len(d.get('roles',[])))\" 2>&1; echo '--- external 3001 ---'; curl -s -m 8 http://101.35.232.194:3001/api/health 2>&1 | head -c 200; echo")
print(out.read().decode(errors="replace").strip()); print("ERR:",err.read().decode(errors="replace").strip())
c.close()
print("=== FIX DONE ===")
