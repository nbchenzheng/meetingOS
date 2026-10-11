import os, paramiko

HOST = "101.35.232.194"
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", password=os.environ["AI_PASS"], timeout=25, look_for_keys=False, allow_agent=False)

def run(cmd):
    _, o, e = c.exec_command(cmd)
    return o.read().decode(errors="replace").strip(), e.read().decode(errors="replace").strip()

print("=== caddy process (how it's launched) ===")
out, err = run("ps aux | grep -i caddy | grep -v grep")
print(out or "(none)")
print("ERR:", err)

print("\n=== caddy version ===")
out, err = run("caddy version 2>&1; which caddy 2>/dev/null")
print(out)

print("\n=== systemd unit for caddy? ===")
out, err = run("systemctl list-units --all | grep -i caddy; echo '---'; ls -la /etc/systemd/system/caddy* 2>/dev/null")
print(out or "(no systemd caddy unit found)")

print("\n=== try common Caddyfile paths ===")
out, err = run("for p in /etc/caddy/Caddyfile /etc/caddy/caddy.json /root/Caddyfile /opt/caddy/Caddyfile /var/lib/caddy/Caddyfile; do [ -f \"$p\" ] && echo \"FOUND: $p\"; done; echo '--- find ---'; find / -maxdepth 4 -iname 'Caddyfile*' 2>/dev/null | head")
print(out or "(none of common paths)")

print("\n=== ports 80/443 listeners ===")
out, err = run("ss -tlnp 2>/dev/null | grep -E ':80 |:443 '")
print(out)

print("\n=== backend still up? ===")
out, err = runat = run("curl -s -m5 http://127.0.0.1:3001/api/health; echo; curl -s -o /dev/null -w 'root=%{http_code}\\n' -m5 http://127.0.0.1:3001/")
print(out)

print("\n=== DNS: meeting.weispace.cloud (from server perspective) ===")
out, err = run("getent hosts meeting.weispace.cloud; echo '--- nslookup ---'; nslookup meeting.weispace.cloud 2>&1 | tail -6")
print(out or "(no resolution on server)")

c.close()
print("\nDONE (read-only)")
