import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp, createUser, setupTestApp, testConfig } from './helpers.js'

const { pool, mailer } = setupTestApp()

// App riêng với hạn mức rất nhỏ để test nhanh (mặc định là 20.000 từ, 500 chủ đề...).
const smallApp = createApp({
  config: testConfig({ QUOTA_WORDS: '3', QUOTA_DECKS: '2', QUOTA_PHRASES: '1', QUOTA_GROUPS: '1' }),
  pool,
  mailer,
})
const word = (text) => ({ word: text, meaning: 'nghĩa' })

describe('Hạn mức dữ liệu mỗi tài khoản', () => {
  it('từ vựng: thêm lẻ và thêm hàng loạt đều bị chặn khi vượt hạn mức; xoá bớt thì thêm lại được', async () => {
    const an = await createUser(smallApp, 'an@example.com')
    expect((await an.post('/words/bulk', { words: [word('a'), word('b')] })).status).toBe(201)

    const tooMany = await an.post('/words/bulk', { words: [word('c'), word('d')] })
    expect(tooMany.status).toBe(409)
    expect(tooMany.body.error.code).toBe('quota_exceeded')
    expect((await an.get('/words')).body).toHaveLength(2) // cả lô bị từ chối, không thêm dở dang

    const third = await an.post('/words', word('c'))
    expect(third.status).toBe(201)
    expect((await an.post('/words', word('d'))).status).toBe(409)

    await an.del(`/words/${third.body.id}`)
    expect((await an.post('/words', word('d'))).status).toBe(201)
  })

  it('hạn mức tính riêng từng người', async () => {
    const an = await createUser(smallApp, 'an@example.com')
    const binh = await createUser(smallApp, 'binh@example.com')
    await an.post('/words/bulk', { words: [word('a'), word('b'), word('c')] })
    expect((await binh.post('/words', word('a'))).status).toBe(201)
  })

  it('chủ đề, câu giao tiếp, nhóm', async () => {
    const an = await createUser(smallApp, 'an@example.com')
    const binh = await createUser(smallApp, 'binh@example.com')

    expect((await an.post('/decks/bulk', { decks: [{ name: 'A' }, { name: 'B' }] })).status).toBe(201)
    expect((await an.post('/decks', { name: 'C' })).body.error.code).toBe('quota_exceeded')

    expect((await an.post('/phrases', { phrase: 'Hi', meaning: 'Chào' })).status).toBe(201)
    expect((await an.post('/phrases', { phrase: 'Bye', meaning: 'Tạm biệt' })).status).toBe(409)

    const group = (await an.post('/groups', { name: 'Nhóm 1' })).body
    expect((await an.post('/groups', { name: 'Nhóm 2' })).status).toBe(409)
    const other = (await binh.post('/groups', { name: 'Nhóm của Bình' })).body
    expect((await an.post('/groups/join', { code: other.invite_code })).status).toBe(409)
    // vào lại nhóm mình ĐÃ ở trong không bị tính là vượt hạn mức
    expect((await an.post('/groups/join', { code: group.invite_code })).status).toBe(200)
  })
})

describe('Giới hạn số request theo tài khoản', () => {
  it('quá 300 request/phút → 429; tính riêng từng tài khoản, không theo IP', async () => {
    const limitedApp = createApp({ config: testConfig({ RATE_LIMIT_ENABLED: 'true' }), pool, mailer })
    // Tạo tài khoản qua app KHÔNG giới hạn (đăng ký có giới hạn riêng theo IP), token dùng chung được.
    const an = await createUser(smallApp, 'an@example.com')
    const binh = await createUser(smallApp, 'binh@example.com')
    const tokenOf = async (email) =>
      (await request(smallApp).post('/auth/login').send({ email, password: 'matkhau123' })).body.access_token
    const anToken = await tokenOf(an.email)
    const binhToken = await tokenOf(binh.email)
    const get = (token) => request(limitedApp).get('/settings').set('Authorization', `Bearer ${token}`)

    const statuses = await Promise.all(Array.from({ length: 301 }, () => get(anToken).then((r) => r.status)))
    expect(statuses.filter((s) => s === 200)).toHaveLength(300)
    expect(statuses.filter((s) => s === 429)).toHaveLength(1)
    const blocked = await get(anToken)
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('rate_limited')
    expect((await get(binhToken)).status).toBe(200) // cùng IP, khác tài khoản → không bị ảnh hưởng
  })
})
