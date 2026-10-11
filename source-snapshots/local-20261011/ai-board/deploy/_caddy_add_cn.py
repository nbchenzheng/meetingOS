import os, paramiko, datetime

HOST = "101.35.232.194"
PATH = "/etc/caddy/Caddyfile"
MARKER = "# ===== AI 大咖会议私董会"
NEW_BLOCK = (
    "\n"
    "# ===== AI 大咖会议私董会 (aiboard) -> Node backend :3001 (Caddy 自动 HTTPS / WebSocket / SSE)\n"
    "meeting.weispace.com.cn {\n"
    "\tencode gzip\n"
    "\treverse_proxy 127.0.0.1:3001\n"
    "}\n"
)

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", password=os.environ["AI_PASS"], timeout=25, look_for_keys=False, allow_agent=False)

def run(cmd):
    _, o, e = c.exec_command(cmd)
    return o.read().decode(errors="replace"), e.read().decode(errors="replace")

# 0) DNS 确认
out, err = run("getent hosts meeting.weispace.com.cn; echo '--- nslookup ---'; nslookup meeting.weispace.com.cn 2>&1 | tail -4")
print("0) DNS meeting.weispace.com.cn:\n", out)

# 1) 读当前 Caddyfile
sftp = c.open_sftp()
with sftp.open(PATH, "r") as f:
    content = f.read().decode("utf-8")
print("1) current tail (last 12 lines):\n", "\n".join(content.splitlines()[-12:]))

# 2) 若存在旧的 aiboard block（.cloud 或其他），从 marker 处截断丢弃
if MARKER in content:
    content = content[: content.index(MARKER)].rstrip() + "\n"
    print("2) removed old aiboard block (if any)")

# 3) 追加 .com.cn 新 block
content = content.rstrip() + "\n" + NEW_BLOCK

# 4) 原子写入（先写 .tmp 再 mv）
with sftp.open(PATH + ".tmp", "w") as f:
    f.write(content.encode("utf-8"))
out, err = run(f"mv -f {PATH}.tmp {PATH} && echo WROTE_OK")
print("3) write:", out, err)

# 5) 备份
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
run(f"cp -p {PATH} {PATH}.bak.aiboard-{stamp} && echo BAK_OK")

# 6) validate
out, err = run(f"caddy validate --config {PATH} 2>&1; echo VALIDATE_EXIT=$?")
print("4) validate:\n", out[-700:], err[-300:])
ok = "VALIDATE_EXIT=0" in out

# 7) reload（仅在校验通过时）
if ok:
    out, err = run(f"caddy reload --config {PATH} 2>&1; echo RELOAD_EXIT=$?")
    print("5) reload:", out[-400:], err[-200:])
    if "RELOAD_EXIT=0" not in out:
        out, err = run("systemctl reload caddy 2>&1; echo SYS_EXIT=$?")
        print("5b) systemctl fallback:", out)
else:
    print("5) SKIPPED reload (validate failed)")

# 8) 验证其他站点不受影响 + 后端仍在
for cmd in [
    "systemctl is-active caddy",
    "curl -s -o /dev/null -w 'claw_2053=%{http_code}\\n' --resolve clawharness.space:2053:127.0.0.1 http://clawharness.space:2053/",
    "curl -sk -o /dev/null -w 'weispace_443=%{http_code}\\n' --resolve weispace.com.cn:443:127.0.0.1 https://weispace.com.cn/",
    "curl -sk -o /dev/null -w 'testfde_443=%{http_code}\\n' --resolve test.fdespace.cn:443:127.0.0.1 https://test.fdespace.cn/",
    "curl -s -o /dev/null -w 'backend=%{http_code}\\n' http://127.0.0.1:3001/",
]:
    o, e = run(cmd)
    print("6)", cmd.split()[0], "->", o[:120])

# 9) 新站点内部连通（强制 resolve 到 127.0.0.1，忽略证书，验证反代链路）
o, e = run("curl -sk -o /dev/null -w 'new_internal=%{http_code}\\n' --resolve meeting.weispace.com.cn:443:127.0.0.1 https://meeting.weispace.com.cn/api/health")
print("7) new site internal:", o)

# 10) 证书是否已签发（SAN 是否包含该域名）
o, e = run("echo | timeout 6 openssl s_client -servername meeting.weispace.com.cn -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -text 2>/dev/null | grep -A1 'Subject Alternative Name' || echo 'CERT_NOT_READY_YET'")
print("8) cert SAN:", o)

c.close()
print("\nDONE")
