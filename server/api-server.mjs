import { createMeetingServer, loadEnvironment } from './platform/server.mjs'

loadEnvironment()
const application=createMeetingServer()
const port=Number(process.env.PORT || 3001)
application.server.listen(port,()=>console.log(`[MeetingOS] 服务已启动，端口 ${port}`))
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>application.close().then(()=>process.exit(0)))
