import os, paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("101.35.232.194", username="root", password=os.environ["AI_PASS"], timeout=25, look_for_keys=False, allow_agent=False)

def run(cmd):
    _, o, e = c.exec_command(cmd)
    return o.read().decode(errors="replace").strip()

print(run("echo '===== /etc/caddy/Caddyfile ($(wc -l < /etc/caddy/Caddyfile) lines) ====='; cat /etc/caddy/Caddyfile"))
c.close()
print("\nDONE (read-only)")
