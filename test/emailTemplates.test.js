import { describe, expect, it } from 'vitest'
import { alreadyRegisteredEmail, passwordResetEmail, verificationEmail } from '../src/lib/emailTemplates.js'

describe('mẫu email', () => {
  it('email xác nhận: có tiêu đề, nút + link dự phòng, bản chữ thuần chứa link', () => {
    const link = 'https://app.vn/#verify_token=abc_123'
    const mail = verificationEmail({ email: 'lan@example.com', name: 'Lan', link, ttlHours: 24 })
    expect(mail.subject).toBe('Xác nhận địa chỉ email của bạn – Từ Vựng')
    expect(mail.html).toContain(`href="${link}"`)
    expect(mail.html).toContain('Xác nhận email</a>')
    expect(mail.html).toContain('Xin chào Lan,')
    expect(mail.text).toContain(link)
    expect(mail.text).toContain('24 giờ')
    expect(mail.text).not.toContain('<')
  })

  it('không chèn được HTML qua tên hiển thị / email', () => {
    const mail = verificationEmail({
      email: 'a@b.vn',
      name: '<img src=x onerror=alert(1)>',
      link: 'https://x',
      ttlHours: 1,
    })
    expect(mail.html).not.toContain('<img')
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('không có tên → lời chào chung; email đặt lại mật khẩu và "đã có tài khoản" cũng có bản HTML', () => {
    expect(verificationEmail({ email: 'a@b.vn', link: 'https://x', ttlHours: 1 }).text).toMatch(/^Xin chào,/)
    expect(passwordResetEmail({ email: 'a@b.vn', link: 'https://x/#reset_token=t', ttlMinutes: 60 }).html).toContain(
      'Đặt mật khẩu mới</a>',
    )
    expect(alreadyRegisteredEmail({ email: 'a@b.vn', appUrl: 'https://x' }).html).toContain('<strong>a@b.vn</strong>')
  })
})
