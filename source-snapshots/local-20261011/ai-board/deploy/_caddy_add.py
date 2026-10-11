import os, paramiko, datetime

HOST = "101.35.232.194"
PATH = "/etc/caddy/Caddyfile"
NEW_BLOCK = """
# ===== AI 大咖会议私董会 (aiboard) -> Node backend :3001 (Caddy 自动 HTTPS / WebSocket / SSE)
meeting.weispace.cloud {
	encode gzip
	reverse_proxy 127.0.0.1:3001
}
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", password=os.environ["AI_PASS"], timeout=25, look_for_keys=False, allow_agent=False)

def run(cmd):
    _, o, e = c.exec_command(cmd)
    return o.read().decode(errors="replace").strip(), e.read().decode(errors="replace").strip()

# 1) 备份（不改旧内容，仅副本）
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
bak = f"{PATH}.bak.before-aiboard.{stamp}"
out, err = run(f"cp -p {PATH} {bak} && echo BACKUP_OK {bak}")
print("1) backup:", out, err)

# 2) 校验当前文件是否含该 block（幂等防护）
out, err = run(f"grep -q 'meeting.weispace.cloud' {PATH} && echo ALREADY_PRESENT || echo NOT_PRESENT")
print("2) pre-check:", out)
if "ALREADY_PRESENT" in out:
    print("   -> block 已存在，跳过追加，直接 reload 校验")
else:
    # 3) 追加新 block
    _, o = run(f"printf '%s' {repr(NEW_BLOCK)} >> {PATH} && echo APPENDED")
    print("3) append:", o)

# 4) validate 整份配置
out, err = run(f"caddy validate --config {PATH} 2>&1; echo VALIDATE_EXIT=$?")
print("4) validate:\n", out, err)

# 5) reload（原子热重载；失败回退 systemctl reload）
out, err = run(f"caddy reload --config {PATH} 2>&1; echo RELOAD_EXIT=$?")
print("5) caddy reload:", out, err)
if "RELOAD_EXIT=0" not in out:
    out, err = run("systemctl reload caddy 2>&1; echo SYSRELOAD_EXIT=$?")
    print("5b) systemctl reload fallback:", out, err)

# 6) 验证其他站点未被影响 + 后端仍在
checks = [
    "systemctl is-active caddy",
    "curl -s -o /dev/null -w 'clawharness_2053=%{http_code}\\n' --resolve clawharness.space:2053:127.0.0.1 http://clawharness.space:2053/",
    "curl -sk -o /dev/null -w 'weispace_443=%{http_code}\\n' --resolve weispace.com.cn:443:127.0.0.1 https://weispace.com.cn/",
    "curl -sk -o /dev/null -w 'test_fdespace_443=%{http_code}\\n' --resolve test.fdespace.cn:443:127.0.0.1 https://test.fdespace.cn/",
    "curl -s -o /dev/null -w 'backend_root=%{http_code}\\n' -m5 http://127.0.0.1:3001/",
    "curl -s -m5 http://127.0.0.1:3001/api/health",
]
print("6) verification:")
for cmd in checks:
    out, err = run(cmd)
    print("   ", cmd.split(' ')[0], "->", out[:160])

# 7) 新站点内部连通性（证书签发前可能 TLS 握手失败，属预期）
out, err = run("curl -sk -o /dev/null -w 'new_site_internal=%{http_code}\\n' --resolve meeting.weispace.cloud:443:127.0.0.1 https://meeting.weispace.cloud/api/health")
print("7) new site internal:", out, "(证书签发前 TLS 可能失败，属预期)")

c.close()
print("\nDONE")
