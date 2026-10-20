import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import express from 'express'
import { createApp } from '../src/app.js'
import { createAuthLimiters } from '../src/middleware/rateLimits.js'
import { FE_ORIGIN, refreshCookieOf, setupTestApp, testConfig } from './helpers.js'

const { app, pool, mailer, config } = setupTestApp()

const register = (email = 'an@example.com', password = 'matkhau123') =>
  request(app).post('/auth/register').send({ email, password })
const login = (email = 'an@example.com', password = 'matkhau123') =>
  request(app).post('/auth/login').send({ email, password })
const refresh = (cookie, origin = FE_ORIGIN) => {
  const req = request(app).post('/auth/refresh').set('Origin', origin)
  return cookie ? req.set('Cookie', `tv_refresh=${cookie}`) : req
}
const me = (token) => request(app).get('/auth/me').set('Authorization', `Bearer ${token}`)

describe('POST /auth/register', () => {
  it('tạo tài khoản, trả phiên đăng nhập và đặt cookie refresh httpOnly', async () => {
    const res = await register('  An@Example.COM ')
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ token_type: 'bearer', expires_in: 900 })
    expect(res.body.access_token).toEqual(expect.any(String))
    // email được chuẩn hoá, không bao giờ lộ password_hash
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email: 'an@example.com',
      display_name: null,
      role: 'user',
      is_admin: false,
      is_super_admin: false,
      email_verified: false, // EMAIL_VERIFICATION mặc định off: dùng được ngay, chưa xác nhận
      created_at: expect.any(String),
    })
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('tv_refresh='))
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/Path=\/auth/)
    expect(cookie).toMatch(/SameSite=Lax/)
  })

  it('từ chối email đã đăng ký, kể cả khác hoa/thường', async () => {
    await register('an@example.com')
    const res = await register('AN@example.com')
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('email_taken')
  })

  it('kiểm tra dữ liệu đầu vào và báo lỗi tiếng Việt theo từng field', async () => {
    let res = await register('khong-phai-email', 'matkhau123')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({ code: 'validation_error', message: 'Địa chỉ email không hợp lệ.' })

    res = await register('an@example.com', '1234567')
    expect(res.body.error.message).toBe('Mật khẩu cần tối thiểu 8 ký tự.')

    res = await request(app).post('/auth/register').send({})
    expect(res.body.error.details.map((d) => d.field)).toEqual(['email', 'password'])
  })

  it('tài khoản cũ có mật khẩu ngắn hơn quy tắc mới vẫn đăng nhập được', async () => {
    await pool.query("insert into users (email, password_hash) values ('cu6@example.com', $1)", [
      bcrypt.hashSync('abc123', 10),
    ])
    expect((await login('cu6@example.com', 'abc123')).status).toBe(200)
  })

  it('giới hạn mật khẩu theo BYTE (bcrypt chỉ đọc 72 byte đầu)', async () => {
    // 30 ký tự "ệ" = 90 byte UTF-8 dù chỉ 30 ký tự
    const res = await register('an@example.com', 'ệ'.repeat(30))
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/72 byte/)
  })
})

describe('POST /auth/login', () => {
  it('đăng nhập đúng → trả phiên mới', async () => {
    await register()
    const res = await login('AN@example.com')
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('an@example.com')
    expect(refreshCookieOf(res)).toBeTruthy()
  })

  it('sai mật khẩu và email không tồn tại trả CÙNG 1 lỗi (không lộ email nào đã đăng ký)', async () => {
    await register()
    const wrongPass = await login('an@example.com', 'saimatkhau')
    const noUser = await login('khongco@example.com', 'matkhau123')
    expect(wrongPass.status).toBe(401)
    expect(noUser.status).toBe(401)
    expect(wrongPass.body).toEqual(noUser.body)
    expect(wrongPass.body.error.code).toBe('invalid_credentials')
  })

  it('đăng nhập dọn token đã hết hạn, giữ token bị thu hồi nhưng còn hạn (để phát hiện dùng lại)', async () => {
    const first = refreshCookieOf(await register())
    await refresh(first) // first bị thu hồi (đã thay thế), vẫn còn hạn
    await pool.query(
      "insert into refresh_tokens (user_id, family_id, token_hash, expires_at) select id, gen_random_uuid(), 'cu-het-han', now() - interval '1 day' from users",
    )
    await login()
    const { rows } = await pool.query('select token_hash from refresh_tokens')
    expect(rows.map((r) => r.token_hash)).not.toContain('cu-het-han')
    expect(rows).toHaveLength(3) // first (đã thu hồi), bản thay thế, phiên đăng nhập mới
  })

  it('đăng nhập được bằng hash bcrypt $2a$ chuyển từ Supabase Auth', async () => {
    const hash2a = bcrypt.hashSync('matkhaucu', 10).replace(/^\$2b\$/, '$2a$')
    await pool.query("insert into users (email, password_hash) values ('cu@example.com', $1)", [hash2a])
    const res = await login('cu@example.com', 'matkhaucu')
    expect(res.status).toBe(200)
  })
})

describe('GET /auth/me và access token', () => {
  it('trả thông tin người dùng khi có token hợp lệ', async () => {
    const { body } = await register()
    const res = await me(body.access_token)
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('an@example.com')
  })

  it('không có token → unauthorized; token giả → invalid_token', async () => {
    let res = await request(app).get('/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('unauthorized')

    res = await me('abc.def.ghi')
    expect(res.body.error.code).toBe('invalid_token')

    // ký bằng secret khác
    const forged = jwt.sign({ email: 'x@x.com' }, 'secret-khac-secret-khac-secret-khac', {
      subject: 'x',
      issuer: 'tuvung-api',
      audience: 'tuvung-app',
    })
    res = await me(forged)
    expect(res.body.error.code).toBe('invalid_token')
  })

  it('token hết hạn → code riêng token_expired để FE biết cần refresh', async () => {
    const { body } = await register()
    const expired = jwt.sign(
      { email: 'an@example.com', exp: Math.floor(Date.now() / 1000) - 10 },
      config.auth.accessSecret,
      { subject: body.user.id, issuer: 'tuvung-api', audience: 'tuvung-app' },
    )
    const res = await me(expired)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('token_expired')
  })
})

describe('POST /auth/refresh', () => {
  it('xoay vòng: trả access token + cookie refresh MỚI', async () => {
    const first = refreshCookieOf(await register())
    const res = await refresh(first)
    expect(res.status).toBe(200)
    expect(res.body.access_token).toEqual(expect.any(String))
    const second = refreshCookieOf(res)
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
    expect((await refresh(second)).status).toBe(200)
  })

  it('không có cookie → 401 và xoá cookie', async () => {
    const res = await refresh(undefined)
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('invalid_refresh_token')
  })

  it('chặn request từ domain lạ (chống CSRF)', async () => {
    const cookie = refreshCookieOf(await register())
    const res = await refresh(cookie, 'https://trang-xau.example')
    expect(res.status).toBe(403)
  })

  it('2 tab refresh gần như đồng thời bằng cùng token → cả 2 đều thành công (cửa sổ ân hạn)', async () => {
    const cookie = refreshCookieOf(await register())
    const [a, b] = await Promise.all([refresh(cookie), refresh(cookie)])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  })

  it('token cũ bị dùng lại sau cửa sổ ân hạn → nghi bị trộm, thu hồi TOÀN BỘ phiên đó', async () => {
    const stolen = refreshCookieOf(await register())
    const current = refreshCookieOf(await refresh(stolen))
    // giả lập đã quá 10 giây kể từ lúc token cũ bị thay thế
    await pool.query("update refresh_tokens set revoked_at = now() - interval '1 minute' where revoked_at is not null")

    const reuse = await refresh(stolen)
    expect(reuse.status).toBe(401)
    // token hợp lệ của người dùng thật cũng bị thu hồi theo → phải đăng nhập lại
    expect((await refresh(current)).status).toBe(401)
  })

  it('không ảnh hưởng tới phiên đăng nhập ở thiết bị khác (family khác)', async () => {
    const deviceA = refreshCookieOf(await register())
    const deviceB = refreshCookieOf(await login())
    await refresh(deviceA)
    await pool.query("update refresh_tokens set revoked_at = now() - interval '1 minute' where revoked_at is not null")
    await refresh(deviceA) // bị phát hiện dùng lại → chỉ family của A bị thu hồi
    expect((await refresh(deviceB)).status).toBe(200)
  })

  it('refresh token hết hạn → 401', async () => {
    const cookie = refreshCookieOf(await register())
    await pool.query("update refresh_tokens set expires_at = now() - interval '1 second'")
    expect((await refresh(cookie)).status).toBe(401)
  })

  it('gia hạn đều đặn vẫn không vượt quá hạn tuyệt đối (90 ngày kể từ lúc đăng nhập)', async () => {
    let cookie = refreshCookieOf(await register())
    const expiresAt = async () =>
      (await pool.query('select expires_at from refresh_tokens where revoked_at is null')).rows[0].expires_at
    // Đăng nhập lúc đầu: hạn = 30 ngày.
    const days = (d) => (d.getTime() - Date.now()) / 86_400_000
    expect(days(await expiresAt())).toBeCloseTo(30, 0)

    // Giả lập đã đăng nhập từ 80 ngày trước: lần gia hạn này chỉ được thêm ~10 ngày, không phải 30.
    await pool.query("update refresh_tokens set session_started_at = now() - interval '80 days'")
    let res = await refresh(cookie)
    expect(res.status).toBe(200)
    expect(days(await expiresAt())).toBeCloseTo(10, 0)
    // Token mới giữ nguyên mốc đăng nhập ban đầu.
    const { rows } = await pool.query(
      "select count(*)::int as n from refresh_tokens where session_started_at > now() - interval '79 days'",
    )
    expect(rows[0].n).toBe(0)

    // Quá 90 ngày → không gia hạn được nữa, phải đăng nhập lại.
    cookie = refreshCookieOf(res)
    await pool.query("update refresh_tokens set session_started_at = now() - interval '91 days'")
    expect((await refresh(cookie)).status).toBe(401)
  })
})

describe('POST /auth/logout', () => {
  it('thu hồi refresh token hiện tại và xoá cookie', async () => {
    const cookie = refreshCookieOf(await register())
    const res = await request(app).post('/auth/logout').set('Origin', FE_ORIGIN).set('Cookie', `tv_refresh=${cookie}`)
    expect(res.status).toBe(204)
    expect(res.headers['set-cookie'][0]).toMatch(/tv_refresh=;/)
    expect((await refresh(cookie)).status).toBe(401)
  })

  it('gọi khi chưa đăng nhập vẫn trả 204', async () => {
    expect((await request(app).post('/auth/logout')).status).toBe(204)
  })
})

describe('Quên / đặt lại mật khẩu', () => {
  const forgot = (email) => request(app).post('/auth/forgot-password').send({ email })
  const reset = (token, password = 'matkhaumoi1') => request(app).post('/auth/reset-password').send({ token, password })
  const tokenFromMail = (mail) => mail.text.match(/#reset_token=([\w-]+)/)[1]

  it('email không tồn tại vẫn trả 202 như bình thường, nhưng không gửi mail', async () => {
    const res = await forgot('khongco@example.com')
    expect(res.status).toBe(202)
    expect(mailer.sent).toHaveLength(0)
  })

  it('email có tồn tại hay không đều chờ đủ thời gian phản hồi tối thiểu (chống dò email qua độ trễ)', async () => {
    await register()
    const minMs = 300
    const slowApp = createApp({ config: testConfig({ PASSWORD_RESET_MIN_RESPONSE_MS: String(minMs) }), pool, mailer })
    for (const email of ['an@example.com', 'khongco@example.com']) {
      const startedAt = Date.now()
      const res = await request(slowApp).post('/auth/forgot-password').send({ email })
      expect(res.status).toBe(202)
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(minMs - 20)
    }
    expect(mailer.sent).toHaveLength(1)
  })

  it('luồng đầy đủ: nhận email → đặt mật khẩu mới → đăng nhập bằng mật khẩu mới', async () => {
    const oldCookie = refreshCookieOf(await register())
    expect((await forgot('An@Example.com')).status).toBe(202)
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0].to).toBe('an@example.com')
    expect(mailer.sent[0].text).toContain(`${FE_ORIGIN}/#reset_token=`)

    const res = await reset(tokenFromMail(mailer.sent[0]))
    expect(res.status).toBe(200)
    expect(res.body.access_token).toEqual(expect.any(String)) // đặt xong là đăng nhập luôn

    expect((await login('an@example.com', 'matkhau123')).status).toBe(401)
    expect((await login('an@example.com', 'matkhaumoi1')).status).toBe(200)
    // mọi phiên cũ (thiết bị khác) bị đăng xuất
    expect((await refresh(oldCookie)).status).toBe(401)
  })

  it('1 link chỉ dùng được 1 lần', async () => {
    await register()
    await forgot('an@example.com')
    const token = tokenFromMail(mailer.sent[0])
    expect((await reset(token)).status).toBe(200)
    const again = await reset(token, 'matkhaukhac2')
    expect(again.status).toBe(400)
    expect(again.body.error.code).toBe('invalid_reset_token')
  })

  it('yêu cầu link mới → link cũ mất hiệu lực', async () => {
    await register()
    await forgot('an@example.com')
    await forgot('an@example.com')
    const [oldMail, newMail] = mailer.sent
    expect((await reset(tokenFromMail(oldMail))).status).toBe(400)
    expect((await reset(tokenFromMail(newMail))).status).toBe(200)
  })

  it('link hết hạn → 400', async () => {
    await register()
    await forgot('an@example.com')
    await pool.query("update password_reset_tokens set expires_at = now() - interval '1 second'")
    expect((await reset(tokenFromMail(mailer.sent[0]))).status).toBe(400)
  })
})

describe('Tên hiển thị', () => {
  it('đặt được khi đăng ký (cắt/gộp khoảng trắng); chuỗi rỗng → null', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'an@example.com', password: 'matkhau123', display_name: '  Nguyễn   Lan ' })
    expect(res.status).toBe(201)
    expect(res.body.user.display_name).toBe('Nguyễn Lan')
    const blank = await request(app)
      .post('/auth/register')
      .send({ email: 'binh@example.com', password: 'matkhau123', display_name: '   ' })
    expect(blank.body.user.display_name).toBeNull()
  })

  it('PUT /auth/profile đổi/xoá tên, GET /auth/me trả tên mới; tên sai quy tắc → 400', async () => {
    const { body } = await register()
    const put = (display_name) =>
      request(app).put('/auth/profile').set('Authorization', `Bearer ${body.access_token}`).send({ display_name })
    const ok = await put('Lan 🌸')
    expect(ok.status).toBe(200)
    expect(ok.body.user).toMatchObject({ email: 'an@example.com', display_name: 'Lan 🌸' })
    expect((await me(body.access_token)).body.user.display_name).toBe('Lan 🌸')
    expect((await put('')).body.user.display_name).toBeNull()
    expect((await put(null)).body.user.display_name).toBeNull()
    expect((await put('a'.repeat(40))).status).toBe(200)
    // Xuống dòng/tab chỉ là khoảng trắng → gộp thành 1 dấu cách; ký tự điều khiển hướng chữ thì bị chặn.
    expect((await put('Lan\n\tAdmin')).body.user.display_name).toBe('Lan Admin')
    for (const bad of ['a'.repeat(41), 'Lan\u202eAdmin', 'Lan\u0000', 123]) {
      const res = await put(bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }
    expect((await request(app).put('/auth/profile').send({ display_name: 'X' })).status).toBe(401)
  })
})

describe('PUT /auth/password', () => {
  it('sai mật khẩu hiện tại → 400; đúng → đổi được và đăng xuất các phiên khác', async () => {
    const { body, headers } = await register()
    const oldCookie = refreshCookieOf({ headers })
    const change = (current_password) =>
      request(app)
        .put('/auth/password')
        .set('Authorization', `Bearer ${body.access_token}`)
        .send({ current_password, password: 'matkhaumoi1' })

    const wrong = await change('saibet')
    expect(wrong.status).toBe(400)
    expect(wrong.body.error.code).toBe('invalid_current_password')

    const ok = await change('matkhau123')
    expect(ok.status).toBe(200)
    expect(refreshCookieOf(ok)).toBeTruthy()
    expect((await refresh(oldCookie)).status).toBe(401)
    expect((await login('an@example.com', 'matkhaumoi1')).status).toBe(200)
  })

  it('bắt buộc đăng nhập', async () => {
    const res = await request(app).put('/auth/password').send({ current_password: 'a', password: 'bbbbbb' })
    expect(res.status).toBe(401)
  })
})

describe('Giới hạn tần suất (rate limit)', () => {
  it('quá 10 lần đăng nhập / 15 phút từ 1 IP → 429', async () => {
    const limitedApp = createApp({ config: testConfig({ RATE_LIMIT_ENABLED: 'true' }), pool, mailer })
    for (let i = 0; i < 10; i++) {
      await request(limitedApp).post('/auth/login').send({ email: 'a@b.com', password: 'x' })
    }
    const res = await request(limitedApp).post('/auth/login').send({ email: 'a@b.com', password: 'x' })
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('rate_limited')
  })

  // Mỗi request từ 1 IP khác nhau (như botnet) → giới hạn theo IP không chặn được.
  const fromIp = (agent, i) => agent.set('X-Forwarded-For', `10.0.${Math.floor(i / 250)}.${i % 250}`)

  it('quá 10 lần đăng nhập SAI vào 1 email từ nhiều IP → 429; email khác không bị ảnh hưởng', async () => {
    const limitedApp = createApp({ config: testConfig({ RATE_LIMIT_ENABLED: 'true' }), pool, mailer })
    await register('an@example.com')
    const tryLogin = (i, email, password = 'sai-mat-khau') =>
      fromIp(request(limitedApp).post('/auth/login'), i).send({ email, password })

    // Viết hoa/khoảng trắng khác nhau vẫn tính chung 1 email.
    for (let i = 0; i < 10; i++) {
      expect((await tryLogin(i, i % 2 ? ' AN@example.com' : 'an@example.com')).status).toBe(401)
    }
    const blocked = await tryLogin(10, 'an@example.com', 'matkhau123') // đúng mật khẩu cũng bị chặn
    expect(blocked.status).toBe(429)
    expect(blocked.body.error).toMatchObject({
      code: 'rate_limited',
      message: expect.stringContaining('Quên mật khẩu'),
    })

    expect((await tryLogin(11, 'binh@example.com')).status).toBe(401)
  })

  it('email chưa đăng ký cũng bị chặn y hệt — 429 không tiết lộ email nào có tài khoản', async () => {
    const limitedApp = createApp({ config: testConfig({ RATE_LIMIT_ENABLED: 'true' }), pool, mailer })
    const tryLogin = (i) =>
      fromIp(request(limitedApp).post('/auth/login'), i).send({ email: 'khongco@example.com', password: 'x' })
    for (let i = 0; i < 10; i++) expect((await tryLogin(i)).status).toBe(401)
    expect((await tryLogin(10)).status).toBe(429)
  })

  it('đăng nhập ĐÚNG không bị tính vào giới hạn theo email', async () => {
    const limitedApp = createApp({ config: testConfig({ RATE_LIMIT_ENABLED: 'true' }), pool, mailer })
    await register('an@example.com')
    for (let i = 0; i < 12; i++) {
      const res = await fromIp(request(limitedApp).post('/auth/login'), i).send({
        email: 'an@example.com',
        password: 'matkhau123',
      })
      expect(res.status).toBe(200)
    }
  })

  it('đăng ký: tối đa 10 lần / giờ / IP (chặn dò email bằng form đăng ký)', async () => {
    const { register: registerLimiter } = createAuthLimiters(true)
    const mini = express()
      .set('trust proxy', 1)
      .post('/r', registerLimiter, (_req, res) => res.status(201).end())
    for (let i = 0; i < 10; i++) expect((await request(mini).post('/r')).status).toBe(201)
    expect((await request(mini).post('/r')).status).toBe(429)
    expect((await request(mini).post('/r').set('X-Forwarded-For', '10.9.9.9')).status).toBe(201)
  })
})

describe('tài khoản cũ chưa có mật khẩu (tạo bằng Google trước khi gỡ tính năng)', () => {
  it('không đăng nhập được bằng mật khẩu bất kỳ, đặt mật khẩu qua "Quên mật khẩu" rồi đăng nhập được', async () => {
    await pool.query("insert into users (email, password_hash) values ('cu-google@example.com', null)")
    expect((await login('cu-google@example.com', 'gidocungduoc')).status).toBe(401)

    await request(app).post('/auth/forgot-password').send({ email: 'cu-google@example.com' })
    await new Promise((r) => setImmediate(r))
    const token = mailer.sent.at(-1).text.match(/#reset_token=([\w-]+)/)[1]
    expect((await request(app).post('/auth/reset-password').send({ token, password: 'matkhaumoi1' })).status).toBe(200)
    expect((await login('cu-google@example.com', 'matkhaumoi1')).status).toBe(200)
  })
})
