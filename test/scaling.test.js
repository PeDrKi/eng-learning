import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { runCleanup } from '../src/jobs/cleanup.js'
import { createApp, createUser, setupTestApp, testConfig } from './helpers.js'

const { app, pool, mailer } = setupTestApp()

describe('Log request (1 dòng JSON mỗi request)', () => {
  function loggedApp(overrides = {}) {
    const lines = []
    const logApp = createApp({
      config: testConfig({ REQUEST_LOG: 'true', ...overrides }),
      pool,
      mailer,
      log: (line) => lines.push(JSON.parse(line)),
    })
    return { logApp, lines }
  }

  it('ghi mẫu đường dẫn (không phải URL thật), mã trạng thái, thời gian, người gọi; không ghi query/body', async () => {
    const { logApp, lines } = loggedApp()
    const an = await createUser(logApp, 'an@example.com')
    const word = (await an.post('/words', { word: 'bí-mật', meaning: 'nghĩa' })).body
    await an.patch(`/words/${word.id}`, { meaning: 'khác' })
    await an.get('/words?limit=5')

    const patch = lines.find((l) => l.method === 'PATCH')
    expect(patch).toMatchObject({ route: '/words/:id', status: 200, user: an.id })
    expect(typeof patch.ms).toBe('number')
    expect(lines.find((l) => l.method === 'GET').route).toBe('/words/')
    const dump = JSON.stringify(lines)
    expect(dump).not.toContain(word.id)
    expect(dump).not.toContain('bí-mật')
    expect(dump).not.toContain('limit=5')
    expect(dump).not.toContain('matkhau123')
  })

  it('trả X-Request-Id trùng với mã trong log; nhận lại mã hợp lệ do proxy gắn; bỏ qua /health', async () => {
    const { logApp, lines } = loggedApp()
    const res = await request(logApp).get('/khong-co')
    expect(res.status).toBe(404)
    expect(lines.at(-1)).toMatchObject({ id: res.headers['x-request-id'], route: '(không khớp)', status: 404 })

    const traced = await request(logApp).get('/khong-co').set('X-Request-Id', 'proxy-abc-12345')
    expect(traced.headers['x-request-id']).toBe('proxy-abc-12345')
    const forged = await request(logApp).get('/khong-co').set('X-Request-Id', 'x"},{"gia-mao":1')
    expect(forged.headers['x-request-id']).not.toContain('gia-mao')

    const before = lines.length
    await request(logApp).get('/health')
    expect(lines).toHaveLength(before)
  })

  it('request chậm hơn SLOW_REQUEST_MS được đánh dấu slow', async () => {
    const { logApp, lines } = loggedApp({ SLOW_REQUEST_MS: '1', PASSWORD_RESET_MIN_RESPONSE_MS: '50' })
    await request(logApp).post('/auth/forgot-password').send({ email: 'ai-do@example.com' })
    expect(lines.at(-1)).toMatchObject({ route: '/auth/forgot-password', slow: true })
  })
})

describe('Nén phản hồi', () => {
  it('phản hồi lớn được nén khi client hỗ trợ', async () => {
    const an = await createUser(app, 'an@example.com')
    await an.post('/words/bulk', {
      words: Array.from({ length: 200 }, (_, i) => ({ word: `word-${i}`, meaning: 'một nghĩa khá dài để nén' })),
    })
    const res = await an.get('/words').set('Accept-Encoding', 'gzip')
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.body).toHaveLength(200) // supertest tự giải nén
  })
})

describe('Kho đếm giới hạn request dùng chung (chạy nhiều instance)', () => {
  it('createApp dùng store được truyền vào cho MỌI bộ giới hạn, mỗi bộ 1 tiền tố riêng', async () => {
    const prefixes = []
    const hits = []
    const rateLimitStore = (prefix) => {
      prefixes.push(prefix)
      return {
        localKeys: false,
        async increment(key) {
          hits.push(prefix + key)
          return { totalHits: 1, resetTime: new Date(Date.now() + 60_000) }
        },
        async decrement() {},
        async resetKey() {},
      }
    }
    const sharedApp = createApp({ config: testConfig({ RATE_LIMIT_ENABLED: 'true' }), pool, mailer, rateLimitStore })
    expect(prefixes.toSorted()).toEqual([
      'rl:api:',
      'rl:credentials:',
      'rl:join:',
      'rl:login-email:',
      'rl:password-reset:',
      'rl:register:',
      'rl:verification-email:',
    ])

    const an = await createUser(sharedApp, 'an@example.com')
    await an.get('/decks')
    expect(hits.some((h) => h.startsWith('rl:credentials:'))).toBe(true)
    expect(hits).toContain(`rl:api:user:${an.id}`)
  })
})

describe('Dọn dữ liệu hết hạn (jobs/cleanup.js)', () => {
  it('xoá token hết hạn, GIỮ token còn hạn (kể cả đã thu hồi); chạy lại nhiều lần vẫn an toàn', async () => {
    const an = await createUser(app, 'an@example.com')
    const insertToken = (hash, expires, revoked = null) =>
      pool.query(
        `insert into refresh_tokens (user_id, family_id, token_hash, expires_at, revoked_at)
         values ($1, gen_random_uuid(), $2, now() + $3::interval, $4)`,
        [an.id, hash, expires, revoked],
      )
    await insertToken('het-han', '-1 hour')
    await insertToken('thu-hoi-con-han', '1 day', new Date())
    await pool.query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at)
       values ($1, 'reset-cu', now() - interval '2 days'), ($1, 'reset-moi-het-han', now() - interval '1 hour')`,
      [an.id],
    )

    expect(await runCleanup(pool)).toEqual({
      refresh_tokens: 1,
      password_reset_tokens: 1,
      email_verification_tokens: 0,
    })
    const { rows } = await pool.query('select token_hash from refresh_tokens where user_id = $1', [an.id])
    expect(rows.map((r) => r.token_hash)).toContain('thu-hoi-con-han')
    expect(rows.map((r) => r.token_hash)).not.toContain('het-han')
    expect(await runCleanup(pool)).toEqual({
      refresh_tokens: 0,
      password_reset_tokens: 0,
      email_verification_tokens: 0,
    })
    expect((await an.get('/auth/me')).status).toBe(200) // phiên đang dùng không bị ảnh hưởng
  })

  it('nhật ký ôn tập: mặc định giữ mãi; chỉ xoá bản cũ khi đặt REVIEW_LOG_RETENTION_DAYS', async () => {
    const an = await createUser(app, 'an@example.com')
    const word = (await an.post('/words', { word: 'a', meaning: 'b' })).body
    await pool.query(
      `insert into review_log (user_id, word_id, quality, reviewed_at)
       values ($1, $2, 2, now() - interval '500 days'), ($1, $2, 2, now() - interval '10 days')`,
      [an.id, word.id],
    )
    expect((await runCleanup(pool)).review_log).toBeUndefined()
    expect((await runCleanup(pool, { reviewLogRetentionDays: 400 })).review_log).toBe(1)
    const { rows } = await pool.query('select count(*)::int as n from review_log where user_id = $1', [an.id])
    expect(rows[0].n).toBe(1)
  })
})

describe('Cấu hình cho việc mở rộng', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'x'.repeat(32) }

  it('giá trị mặc định hợp với 1 instance; chỉnh được bằng biến môi trường', () => {
    expect(loadConfig(base)).toMatchObject({ dbPoolMax: 10, requestLog: true, slowRequestMs: 1000 })
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).requestLog).toBe(false)
    expect(loadConfig({ ...base, DB_POOL_MAX: '25', REVIEW_LOG_RETENTION_DAYS: '400' })).toMatchObject({
      dbPoolMax: 25,
      reviewLogRetentionDays: 400,
    })
    expect(() => loadConfig({ ...base, DB_POOL_MAX: '0' })).toThrow()
  })
})
