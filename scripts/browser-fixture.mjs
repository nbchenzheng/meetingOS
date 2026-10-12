// Controlled local browser fixture. Never used by npm start or production.
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMeetingServer } from "../server/platform/server.mjs";
const gateway = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const { messages } = JSON.parse(raw);
  const customer = messages[0].content.includes("会谈智囊");
  const summary = messages[0].content.includes("整理一份");
  const text = summary
    ? "## 讨论要点\n交付范围、预算与上线时间仍需对齐。\n## 已确认决定\n按会议中的确认记录执行。\n## 行动项\n负责人和期限待确认。\n## 风险与未决问题\n确认首期范围，避免承诺超过现有能力。 [brief]"
    : customer
      ? "## 建议回答\n“可以先确认首期范围，报价和交付时间需要一起评估。我们会整理可选方案，再确认承诺。”\n## 依据\n产品资料说明标准部署需要三周。 [brief]\n## 风险 / 待核实\n报表接口是否包含在首期，仍需技术确认。"
      : "## 预算与范围需要先对齐\n当前方案预算为14万元，超过12万元的预算上限。建议先明确首期范围，再安排工作。 [brief]\n## 建议追问\n“首期必须包含哪些功能？哪些可以在第二阶段交付？”";
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (let index = 0; index < text.length; index += 20) {
    res.write(
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: text.slice(index, index + 20) } }],
        }) +
        "\n\n",
    );
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  res.end("data: [DONE]\n\n");
});
gateway.listen(0, "127.0.0.1");
await once(gateway, "listening");
process.env.LINKHARBOR_API_KEY = "browser-controlled-fixture";
process.env.LINKHARBOR_BASE_URL =
  "http://127.0.0.1:" + gateway.address().port + "/v1";
process.env.WEI_LLM_API_KEY = "browser-controlled-wei-fixture";
process.env.WEI_LLM_BASE_URL = process.env.LINKHARBOR_BASE_URL;
process.env.MEETINGOS_TEST_MODE = "true";
process.env.NODE_ENV = "development";
delete process.env.MEETINGOS_INVITE_CODE;
delete process.env.MEETINGOS_PUBLIC_URL;
const dataDir = mkdtempSync(join(tmpdir(), "meetingos-browser-")),
  app = createMeetingServer({ dataDir });
app.server.listen(Number(process.env.PORT || 3165), "127.0.0.1");
await once(app.server, "listening");
writeFileSync(
  join(dataDir, "fixture.json"),
  JSON.stringify({ dataDir, port: app.server.address().port }),
);
console.log(
  "Controlled browser fixture ready on port " + app.server.address().port,
);
async function close() {
  await app.close();
  gateway.closeAllConnections();
  await new Promise((resolve) => gateway.close(resolve));
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
