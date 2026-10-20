import { describe, expect, it, vi } from 'vitest'
import { createMailer, parseAddress } from '../src/lib/mailer.js'

describe('mailer — driver resend (HTTP API, dùng được trên gói miễn phí của Render)', () => {
  const config = { driver: 'resend', resendApiKey: 're_test123', from: 'Từ Vựng <no-reply@tenmien.com>' }

  it('gọi đúng endpoint với API key và nội dung email', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    await createMailer(config, { fetchImpl }).send({ to: 'an@example.com', subject: 'Chào', text: 'Nội dung' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer re_test123')
    expect(JSON.parse(init.body)).toEqual({
      from: 'Từ Vựng <no-reply@tenmien.com>',
      to: ['an@example.com'],
      subject: 'Chào',
      text: 'Nội dung',
    })
  })

  it('có bản HTML → gửi kèm html', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    await createMailer(config, { fetchImpl }).send({ to: 'a@b.vn', subject: 's', text: 't', html: '<p>t</p>' })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).html).toBe('<p>t</p>')
  })

  it('Resend trả lỗi → ném lỗi kèm mã và chi tiết (được ghi vào log server)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'domain not verified' })
    await expect(createMailer(config, { fetchImpl }).send({ to: 'x@y.com', subject: 's', text: 't' })).rejects.toThrow(
      /403: domain not verified/,
    )
  })
})

describe('mailer — driver brevo (HTTP API, gửi bằng Gmail đã xác minh)', () => {
  const config = { driver: 'brevo', brevoApiKey: 'xkeysib-test', from: 'Từ Vựng <ban@gmail.com>' }

  it('gọi đúng endpoint với api-key, người gửi tách tên + email, kèm bản HTML', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    await createMailer(config, { fetchImpl }).send({
      to: 'an@example.com',
      subject: 'Chào',
      text: 'Nội dung',
      html: '<p>Nội dung</p>',
    })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.brevo.com/v3/smtp/email')
    expect(init.method).toBe('POST')
    expect(init.headers['api-key']).toBe('xkeysib-test')
    expect(JSON.parse(init.body)).toEqual({
      sender: { name: 'Từ Vựng', email: 'ban@gmail.com' },
      to: [{ email: 'an@example.com' }],
      subject: 'Chào',
      textContent: 'Nội dung',
      htmlContent: '<p>Nội dung</p>',
    })
  })

  it('Brevo trả lỗi → ném lỗi kèm mã và chi tiết', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'sender not valid' })
    await expect(createMailer(config, { fetchImpl }).send({ to: 'x@y.com', subject: 's', text: 't' })).rejects.toThrow(
      /400: sender not valid/,
    )
  })

  it('parseAddress: có tên, tên trong ngoặc kép, chỉ có email', () => {
    expect(parseAddress('Từ Vựng <a@b.vn>')).toEqual({ name: 'Từ Vựng', email: 'a@b.vn' })
    expect(parseAddress('"Từ Vựng" <a@b.vn>')).toEqual({ name: 'Từ Vựng', email: 'a@b.vn' })
    expect(parseAddress('a@b.vn')).toEqual({ email: 'a@b.vn' })
    expect(parseAddress('<a@b.vn>')).toEqual({ email: 'a@b.vn' })
  })
})

describe('mailer — driver console', () => {
  const msg = { to: 'an.nguyen@example.com', subject: 'Đặt lại mật khẩu', text: 'Link: https://x/#reset_token=BIMAT' }

  it('khi phát triển: in đủ nội dung để bấm link thử', async () => {
    const log = vi.fn()
    await createMailer({ driver: 'console' }, { log }).send(msg)
    expect(log.mock.calls[0][0]).toContain('reset_token=BIMAT')
  })

  it('production (logBody: false): KHÔNG in nội dung hay token, email bị che bớt', async () => {
    const log = vi.fn()
    await createMailer({ driver: 'console', logBody: false }, { log }).send(msg)
    const line = log.mock.calls[0][0]
    expect(line).not.toContain('BIMAT')
    expect(line).not.toContain('an.nguyen')
    expect(line).toContain('a***@example.com')
    expect(line).toContain('Đặt lại mật khẩu')
  })
})
