import { spawn } from "node:child_process";
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
function start(name, args) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`${name} exited (${code})`);
      stop(code || 1);
    }
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
start("API", ["server/api-server.mjs"]);
start("Vite", [
  "node_modules/vite/bin/vite.js",
  "--host",
  "127.0.0.1",
  "--port",
  process.env.VITE_PORT || "5173",
  "--strictPort",
  ...process.argv.slice(2),
]);
