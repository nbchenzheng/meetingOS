// src/lib/email.test.ts —— 邮箱格式校验（零网络）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateEmail } from './email.ts'

test('validateEmail: 合法邮箱通过', () => {
  assert.equal(validateEmail('boss@example.com'), true)
  assert.equal(validateEmail('a.b+c@sub.domain.io'), true)
  assert.equal(validateEmail('x@y.z'), true)
})

test('validateEmail: 非法/空/超长不通过', () => {
  assert.equal(validateEmail(''), false)
  assert.equal(validateEmail('   '), false)
  assert.equal(validateEmail('no-at'), false)
  assert.equal(validateEmail('a@b'), false) // 无点分域
  assert.equal(validateEmail('a@@b.com'), false)
  assert.equal(validateEmail('a b@c.com'), false) // 含空白
  assert.equal(validateEmail('x'.repeat(300) + '@y.com'), false) // 超 254
})

test('validateEmail: 非字符串输入安全返回 false', () => {
  assert.equal(validateEmail(null as unknown as string), false)
  assert.equal(validateEmail(undefined as unknown as string), false)
  assert.equal(validateEmail(123 as unknown as string), false)
})
