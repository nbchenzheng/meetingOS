import 'dotenv/config'
import { generateOpinion } from './server/board-service.mjs'

const role = {
  id: 'steve_jobs', cn: '乔布斯', title: '苹果联合创始人',
  persona: '产品极致主义者，以用户痛点和体验极简为信仰，强调科技与人文交叉，发言犀利直指本质。',
  focus: ['用户体验','产品定位','痛点','极简','差异化','品牌'],
  model: 'deepseek-v4-pro', provider: 'deepseek',
}
const transcript = '我们打算做一款面向高管的会议助手，但团队对要不要先做语音转写还是先做 AI 意见有分歧，预算也有限。'
const docs = '项目：AI 大咖会议私董会。目标：高层开会时虚拟董事会实时给意见。'

let full = ''
try {
  for await (const d of generateOpinion({ role, transcript, docs })) full += d
  console.log('RESULT_LEN=' + full.length)
  console.log('SNIPPET=' + full.slice(0, 160))
} catch (e) {
  console.log('ERROR=' + (e && e.message))
}
