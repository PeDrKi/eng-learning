import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { FE_ORIGIN, refreshCookieOf, setupTestApp } from './helpers.js'

const { app, pool, mailer } = setupTestApp({ EMAIL_VERIFICATION: 'required' })

const register = (email, password = 'matkhau123') => request(app).post('/auth/register').send({ email, password })
const login = (email, password = 'matkhau123') => request(app).post('/auth/login').send({ email, password })
const verify = (token) => request(app).post('/auth/verify-email').send({ token })
const resend = (email) => request(app).post('/auth/resend-verification').send({ email })
// Email gửi đi chạy nền → đợi 1 nhịp cho chắc.
const flush = () => new Promise((r) => setImmediate(r))
const tokenFromMail = (mail) => mail.text.match(/#verify_token=([\w-]+)/)[1]
const lastMail = async () => {
  await flush()
  return mailer.sent.at(-1)
}

describe('xác nhận email khi đăng ký (EMAIL_VERIFICATION=required)', () => {
  it('đăng ký → 202, chưa có phiên, email có link; chưa bấm link thì không đăng nhập được', async () => {
    const res = await register('An@Example.com')
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ verification_required: true, email: 'an@example.com' })
    expect(res.body.access_token).toBeUndefined()
    expect(refreshCookieOf(res)).toBeUndefined()

    const mail = await lastMail()
    expect(mail.to).toBe('an@example.com')
    expect(mail.text).toContain(`${FE_ORIGIN}/#verify_token=`)

    const denied = await login('an@example.com')
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('email_not_verified')
    // Sai mật khẩu vẫn chỉ báo sai mật khẩu — không lộ trạng thái tài khoản.
    expect((await login('an@example.com', 'saimatkhau')).body.error.code).toBe('invalid_credentials')
  })

  it('bấm link → đăng nhập luôn, email_verified=true; link chỉ dùng 1 lần; sau đó đăng nhập bình thường', async () => {
    await register('binh@example.com')
    const token = tokenFromMail(await lastMail())

    const res = await verify(token)
    expect(res.status).toBe(200)
    expect(res.body.access_token).toBeTruthy()
    expect(refreshCookieOf(res)).toBeTruthy()
    expect(res.body.user).toMatchObject({ email: 'binh@example.com', email_verified: true })

    const again = await verify(token)
    expect(again.status).toBe(400)
    expect(again.body.error.code).toBe('invalid_verify_token')
    expect((await login('binh@example.com')).status).toBe(200)
  })

  it('link sai / hết hạn → 400', async () => {
    expect((await verify('khong-ton-tai')).body.error.code).toBe('invalid_verify_token')
    await register('het@example.com')
    const token = tokenFromMail(await lastMail())
    await pool.query("update email_verification_tokens set expires_at = now() - interval '1 second'")
    expect((await verify(token)).status).toBe(400)
  })

  it('email đã có tài khoản đã xác nhận → vẫn 202 như thường, email báo "đã có tài khoản", không đổi mật khẩu', async () => {
    await register('co@example.com')
    await verify(tokenFromMail(await lastMail()))

    const res = await register('co@example.com', 'matkhaukhac1')
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ verification_required: true, email: 'co@example.com' })
    const mail = await lastMail()
    expect(mail.subject).toContain('đã có tài khoản')
    expect(mail.text).not.toContain('verify_token')
    expect((await login('co@example.com')).status).toBe(200)
    expect((await login('co@example.com', 'matkhaukhac1')).status).toBe(401)
  })

  it('người khác đăng ký trước bằng email của mình: link trong email của mình kích hoạt mật khẩu của mình', async () => {
    await register('lan@example.com', 'cuakela1234')
    const attackerLink = tokenFromMail(await lastMail())
    await pool.query("update email_verification_tokens set created_at = now() - interval '2 minutes'")

    await register('lan@example.com', 'cuachuthat1')
    const ownerLink = tokenFromMail(await lastMail())
    expect(ownerLink).not.toBe(attackerLink)

    expect((await verify(ownerLink)).status).toBe(200)
    expect((await login('lan@example.com', 'cuachuthat1')).status).toBe(200)
    expect((await login('lan@example.com', 'cuakela1234')).status).toBe(401)
    // Link còn lại hết tác dụng.
    expect((await verify(attackerLink)).status).toBe(400)
  })

  it('gửi lại link: luôn 202; chỉ gửi cho tài khoản đang chờ; tối đa 1 email / phút', async () => {
    await register('gui@example.com')
    await flush()
    mailer.sent.length = 0

    expect((await resend('gui@example.com')).status).toBe(202)
    await flush()
    expect(mailer.sent).toHaveLength(0) // vừa gửi lúc đăng ký → chờ 1 phút

    await pool.query("update email_verification_tokens set created_at = now() - interval '2 minutes'")
    await resend('gui@example.com')
    const mail = await lastMail()
    expect(mail.to).toBe('gui@example.com')
    // Link gửi lại giữ nguyên mật khẩu đã đặt lúc đăng ký.
    expect((await verify(tokenFromMail(mail))).status).toBe(200)
    expect((await login('gui@example.com')).status).toBe(200)

    mailer.sent.length = 0
    const unknown = await resend('khongco@example.com')
    expect(unknown.status).toBe(202)
    await resend('gui@example.com') // đã xác nhận → không gửi nữa
    await flush()
    expect(mailer.sent).toHaveLength(0)
  })

  it('đặt lại mật khẩu qua email cũng xác nhận email', async () => {
    await register('quen@example.com')
    await request(app).post('/auth/forgot-password').send({ email: 'quen@example.com' })
    const mail = await lastMail()
    const resetToken = mail.text.match(/#reset_token=([\w-]+)/)[1]
    const res = await request(app).post('/auth/reset-password').send({ token: resetToken, password: 'matkhaumoi1' })
    expect(res.status).toBe(200)
    expect(res.body.user.email_verified).toBe(true)
    expect((await login('quen@example.com', 'matkhaumoi1')).status).toBe(200)
  })

  it('tài khoản bị khoá: link xác nhận không cấp phiên', async () => {
    await register('khoa@example.com')
    const token = tokenFromMail(await lastMail())
    await pool.query("update users set disabled_at = now() where email = 'khoa@example.com'")
    const res = await verify(token)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('account_disabled')
  })
})

describe('cấu hình', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'x'.repeat(32) }
  it('production bật xác nhận email mà MAIL_DRIVER=console → không khởi động', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', EMAIL_VERIFICATION: 'required' })).toThrow(
      /EMAIL_VERIFICATION/,
    )
    expect(
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        EMAIL_VERIFICATION: 'required',
        MAIL_DRIVER: 'smtp',
        SMTP_URL: 'smtps://a:b@smtp.gmail.com:465',
      }).auth.emailVerification,
    ).toBe(true)
  })
  it('mặc định tắt', () => {
    expect(loadConfig(base).auth.emailVerification).toBe(false)
  })
})
