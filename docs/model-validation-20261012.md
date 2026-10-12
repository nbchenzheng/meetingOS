# 真实模型接入验证

**后续分工已调整：LinkHarbor 仅用于 GPT/Claude/Gemini，DeepSeek Flash 走 wei.run，阿里百炼用于 ASR。以下 LinkHarbor DeepSeek 测试是历史记录，当前配置以 [本地交接](local-handoff.md) 为准。**

2026-10-12（新加坡时间）。使用用户上传的凭证文档，仅在开发环境运行；文档及凭证位于仓库外，未写入代码、日志或报告。未连接生产服务器。

## 接入结果

LinkHarbor 的 `/models` 鉴权成功。通过 MeetingOS 真实的创建会议→助手 SSE→SQLite 保存链路测试以下网关型号：

| 网关型号标识 | 结果 | 首字等待 | 完成时间 |
| --- | --- | --- | --- |
| `gpt-5.6-sol-lh1` | 成功、私有保存、引用 brief | 8.4 秒 | 10.0 秒 |
| `claude-opus-4-8-aws` | 成功、私有保存、引用 brief | 14.0 秒 | 14.0 秒 |
| `claude-sonnet-5-aws` | 成功、私有保存、引用 brief | 14.9 秒 | 14.9 秒 |
| `deepseek-v4-pro` | 成功、私有保存、引用 brief | 18.0 秒 | 19.1 秒 |
| `deepseek-v4-flash` | 成功、私有保存、引用 brief | 9.4 秒 | 10.7 秒 |

输入仅为合成会议：12万元预算、14万元报价、至少三周部署、五天内交付、责任人未定。成功回复识别了预算与交期冲突，并提出明确负责人、调整范围或交付计划等建议。详细输出和时间见 [结构化证据](evidence/model-validation-20261012/results.json)。这是单次链路验收，不是质量评测或延迟基准；型号名称是网关标识，未独立核验底层模型身份。

`gpt-5.5-oa` 虽在模型列表中可见，但实际请求返回上游 502/503；`gpt-5.5-gvs` 返回上游分组无权访问。网站准确返回错误，没有保存伪造建议。验证后采用可成功调用的 `gpt-5.6-sol-lh1` 作为本次开发配置，未修改全体用户的硬编码默认型号。

## 当前配置方式

海外模型设置 `LINKHARBOR_BASE_URL=https://api.linkharbor.ai/v1`，并通过受保护配置提供 `LINKHARBOR_API_KEY`。

- `MEETINGOS_GPT_MODEL=gpt-5.6-sol-lh1`
- `MEETINGOS_CLAUDE_MODEL=claude-opus-4-8-aws`

本次 DeepSeek 同样通过 LinkHarbor 调用：`DEEPSEEK_BASE_URL=https://api.linkharbor.ai/v1`，对应的 `DEEPSEEK_API_KEY` 使用该网关凭证；`MEETINGOS_DEEPSEEK_MODEL` 可用已验证的 `deepseek-v4-pro` 或 `deepseek-v4-flash`。不要把 LinkHarbor 凭证直接发送给 api.deepseek.com。测试进程在内存中载入凭证，未生成仓库内 .env。

## 未打通部分

`api.wei.run` 和 `llm-h7f12a4pszr0zn4n.cn-beijing.maas.aliyuncs.com` 的 HTTPS CONNECT 被当前云代理返回403，未到达接口，不能据此判断 Key 有效性。这两个域名及凭证需求已添加到云环境草稿，保留原有域名；草稿保存不等于运行策略已应用。环境设置需要审核、保存并发布后才能继续验证。上传文件的值没有自动导入环境密钥库；当前工具只支持声明凭证需求，未来环境应使用受保护绑定。现有 DEEPSEEK_API_KEY 需求限定 api.deepseek.com；改用本次 LinkHarbor 路由时，需要在环境设置将该绑定目标改为 api.linkharbor.ai，不能直接向错误域名发送同一凭证。

当前已有真实 GPT/Claude/DeepSeek 调用证据，但首字仍需约8–18秒，不能称作即时耳边答复。需继续做上下文预算、自动触发节奏和快慢模型路由。真实麦克风/云ASR与多次稳定性、成本尚未验收，用户提供的阿里云地址是 LLM 接口，不当作 ASR 凭证使用。
