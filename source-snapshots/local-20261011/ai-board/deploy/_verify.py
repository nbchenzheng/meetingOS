#!/usr/bin/env python3
import os, paramiko
HOST="101.35.232.194"; USER="root"; PASS=os.environ.get("AI_PASS","")
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST,username=USER,password=PASS,timeout=25,look_for_keys=False,allow_agent=False)
_,out,err=c.exec_command("echo 'root='$(curl -s -o /dev/null -w '%{http_code}' -m5 http://127.0.0.1:3001/); echo ' health='$(curl -s -o /dev/null -w '%{http_code}' -m5 http://127.0.0.1:3001/api/health); echo ' roles='$(curl -s -m5 http://127.0.0.1:3001/api/roles|python3 -c \"import sys,json;print(len(json.load(sys.stdin).get('roles',[]))\") 2>/dev/null); echo ' port3001_listen='$(ss -tlnp 2>/dev/null|grep -c ':3001 ')")
print(out.read().decode(errors="replace").strip())
c.close()
