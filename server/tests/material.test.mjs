import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { extractMaterialTextFromFile } from "../material-service.mjs";

function zip(files) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [path, text] of files) {
    const name = Buffer.from(path),
      raw = Buffer.from(text),
      data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(Buffer.concat(centrals).length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
function extract(fileName, raw) {
  return extractMaterialTextFromFile({
    fileName,
    fileData: raw.toString("base64"),
  });
}

test("DOCX/PPTX提取文字，并跳过无需解压的媒体内容", () => {
  const doc = zip([
    ["word/document.xml", "<w:p>部署需要三周 &amp; 验收</w:p>"],
    ["word/media/image.xml", "x".repeat(6 * 1024 * 1024)],
  ]);
  assert.equal(extract("方案.docx", doc).extractedText, "部署需要三周 & 验收");
  const slides = zip([
    ["ppt/slides/slide2.xml", "<a:t>第二页</a:t>"],
    ["ppt/slides/slide1.xml", "<a:t>第一页</a:t>"],
  ]);
  assert.equal(extract("资料.pptx", slides).extractedText, "第一页 第二页");
});
test("拒绝超量解压和超过10000条目的附件", () => {
  const bomb = zip([["word/document.xml", "x".repeat(6 * 1024 * 1024)]]);
  assert.throws(() => extract("超量.docx", bomb));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(10001, 10);
  assert.throws(() => extract("过多.pptx", end), /archive_entry_limit/);
});
test("异常PDF数字数组不阻塞解析进程；基础文字仍可提取", () => {
  assert.equal(
    extract(
      "简单.pdf",
      Buffer.from("%PDF-1.4\n(Delivery needs three weeks) Tj"),
    ).extractedText,
    "Delivery needs three weeks",
  );
  const source =
    "import {extractMaterialTextFromFile} from './server/material-service.mjs';const raw=Buffer.from('%PDF-1.4\\n['+'1'.repeat(100000)+'X');const result=extractMaterialTextFromFile({fileName:'invalid.pdf',fileData:raw.toString('base64')});if(result.extractedText)process.exit(1)";
  execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: new URL("../../", import.meta.url),
    timeout: 2000,
    stdio: "pipe",
  });
});
