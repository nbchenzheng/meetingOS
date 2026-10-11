import os, paramiko, datetime, tarfile

HOST = "101.35.232.194"
LOCAL = r"D:\works\workbuddy\meetingOS\ai-board\deploy\_out_update.tar.gz"
REMOTE_TAR = "/opt/aiboard/_out_update.tar.gz"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", password=os.environ["AI_PASS"], timeout=25, look_for_keys=False, allow_agent=False)

def run(cmd):
    _, o, e = c.exec_command(cmd)
    return o.read().decode(errors="replace").strip(), e.read().decode(errors="replace").strip()

# 1) 本地打包完整性自检
assert tarfile.is_tarfile(LOCAL), "本地 tar 损坏"
print("1) local tar OK")

# 2) SFTP 上传
sftp = c.open_sftp()
sftp.put(LOCAL, REMOTE_TAR)
print("2) uploaded ->", REMOTE_TAR)

# 3) 备份旧 out + 解包新 out + 清理
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
out, err = run(
    f"cd /opt/aiboard && "
    f"mv out out.bak.{stamp} && "
    f"tar xzf {REMOTE_TAR} && "
    f"rm -f {REMOTE_TAR} && "
    f"echo EXTRACTED; ls -d out && ls out/assets"
)
print("3) extract:\n", out, err)

# 4) 重启服务
out, err = run("systemctl restart aiboard 2>&1; sleep 3; echo ACTIVE=$(systemctl is-active aiboard)")
print("4) restart:", out, err)

# 5) 冒烟：健康检查 + 首页 + 角色数
for cmd in [
    "curl -s -o /dev/null -w 'root=%{http_code}\\n' -m5 https://127.0.0.1:3001/",
    "curl -s -m5 http://127.0.0.1:3001/api/health",
    "curl -s -m5 http://127.0.0.1:3001/api/roles | python3 -c \"import sys,json;d=json.load(sys.stdin);print('roles=',len(d.get('roles',[])))\"",
]:
    o, e = run(cmd)
    print("5)", cmd.split()[0], "->", o[:160])

c.close()
print("\nDONE")
