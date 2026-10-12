# 当前平台 API 与数据边界

Node24，单实例SQLite。前缀 `/api/v1`，JSON请求/响应。除注册/登录和 `/api/health` 外全部鉴权；旧匿名 `/api/meeting` 等接口不再是新平台入口。

人类使用HttpOnly、SameSite=Strict的会话Cookie；HTTPS生产使用Secure Cookie，设置 `MEETINGOS_PUBLIC_URL` 为实际HTTPS源。写请求校验Origin，Agent使用Authorization Bearer。生产注册需要内部邀请码。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `/auth/register`, `/auth/login`, `/auth/logout` | POST | 注册/登录/退出 |
| `/auth/me` | GET | 当前身份 |
| `/assistants` | GET | 预设助手与实际配置型号/凭证存在状态 |
| `/tokens` | GET/POST | 人类管理授权，原始令牌只创建时返回 |
| `/tokens/{id}` | DELETE | 人类撤销自己的授权，关闭现有连接/在途请求 |
| `/agent/skill` | GET | 下载Hermes Skill |
| `/meetings` | GET/POST | 本账号且授权允许的会议列表/创建 |
| `/meetings/{id}` | GET/PATCH | 简报、模式、内部约束、助手、自动开关、status（active/completed） |
| `/meetings/{id}/events` | GET/POST | 分页记录/幂等追加 |
| `/meetings/{id}/events/{eventId}` | PATCH | revision并发修订，保留原文和修订历史 |
| `/meetings/{id}/materials` | GET/POST | 允许读取的资料；POST fileName/mimeType/base64/visibility，最大15MB |
| `/meetings/{id}/materials/{materialId}` | PATCH/DELETE | revision 并发校验；visibility/included 设置；人类删除 |
| `/meetings/{id}/materials/{materialId}/file` | GET | 下载保存的原始文件 |
| `/meetings/{id}/changes` | GET | 游标回放，after/hasMore/cursor |
| `/meetings/{id}/stream` | GET | SSE变化流，after或Last-Event-ID，重连回放 |
| `/meetings/{id}/assistant` | POST | advice/summary；支持Accept:text/event-stream |
| `/meetings/{id}/export` | GET | Markdown导出；默认customer，internal需private:read |

事件类型speech/note/decision/action/advice/summary。POST人工/Agent不能直接写summary；模型总结由助手接口生成。advice强制私有。模型选择和自动建议开关由人类设置，普通资料写入令牌不能绕过assistant:ask触发模型调用。Agent不能直接创建或修改已确认决定/行动项，应先提交私有建议等待人类采纳。相同ID与相同内容重试返回原记录，不追加；同ID不同内容409。修订需提供当前revision，过期409。附加元数据限20000字符；question须为文本，sources须为含id/label/excerpt文本的列表，错误类型400，避免外部Agent数据破坏页面。

客户展示、事件分页、变化流可带 `audience=customer`。服务器排除私有事件/约束，并去掉原始旧文和附加引用元数据。共享改私有时发出 `event.removed`；重连按当前可见性投影，不重放已转为私有的旧公开文字。人类私有记录的公开转换必须显式操作；Agent不能执行该转换。

资料可设置 `visibility:private/shared`；网页上传默认私有，兼容旧 REST 客户端的省略值仍为 shared。私有资料的列表/下载/变化流需要 private:read，上传或修改需要 private:write；客户受众始终排除私有资料。Agent不能将私有资料公开或删除文件。设置 `included:false` 保留文件，但不参与后续模型上下文；选择适用于下一次请求，不撤回已经发给模型的内容。PATCH 需当前 revision；过期返回409。删除同时移除原文件、提取文字及资料变化历史，并发出 material.removed；已有会议记录、建议及引用不随之删除。内容去重限定到同一会议及相同可见性，避免共享上传获得私有文件ID。第一版数据库自动补齐资料字段；历史资料保留为 shared/included:true。文字提取支持TXT/MD/PDF/DOCX/PPTX，DOCX/PPTX限制ZIP条目和解压量，扫描PDF没有OCR；PDF仅有基础文字抽取，压缩或特殊字体编码的常见文件可能失败，此时应转为TXT。原文件以BLOB保留并按内容去重。

SSE有change/cursor/ready/assistant-error。ready.reload=true表示回放超过1000条，应重新分页加载。心跳每15秒，有效期到达时关闭；撤销/退出立即关闭。每账号最多15个变化连接。自动建议去抖1400ms，连续发言最多等待8000ms启动分析（前一个请求占用时需等待）；结束会议自动关闭开关并取消自动分析，继续会议不自动重新启用。状态由人类控制，手动查看、总结和修订仍可用；人工请求取消同会议正在执行的自动分析，两个人工请求并行返回409。

模型接口输入包含目标、允许的私有约束、资料、修订后记录、先前建议。160000字符预算超限413，不裁切原始数据库；60秒超时；同一会议一个执行中的模型任务。建议默认private，共享总结只读共享上下文；生成期间上下文变化返回409，避免发布基于已撤回共享资料的结果。返回sources只包含实际输出引用的有效ID，不把全部资料虚构成引用。

总结缓存包含上下文版本/模型/受众/私有范围/问题；更新发言/资料/简报失效，修订总结清除该总结的缓存映射。模型输出是待核实建议，人类确认后新增decision/action，并记录adoptedFrom，不改写原建议。

范围令牌最多90天，权限列表见Skill。账号不匹配404，授权会议范围或权限不足403，失效401。令牌不能管理授权。当前没有组织共享、OAuth授权服务器、MCP协议传输或自动Agent存储镜像。

旧JSON与旧培训/答辩SQLite没有自动迁移，运行主入口不加载它们。备份新库应使用SQLite备份方式或停掉本项目后同时保存主文件/WAL；不能在写入中只复制主文件。程序使用WAL和事务，部署时必须给数据库目录读写权限。
