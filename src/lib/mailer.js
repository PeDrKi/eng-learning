import nodemailer from 'nodemailer'

// Mailer có 1 hàm duy nhất: send({ to, subject, text, html? }) — html là bản có giao diện
// (lib/emailTemplates.js), text là bản chữ thuần đi kèm.
//  • console: in email ra log — dùng khi phát triển, không cần cấu hình gì. Trên production
//    (`logBody: false`) KHÔNG in nội dung: email đặt lại mật khẩu chứa link kèm token, ai đọc
//    được log là chiếm được tài khoản. Chỉ ghi 1 dòng (email đã che bớt + tiêu đề) để biết là
//    email chưa được gửi đi vì chưa cấu hình dịch vụ email thật.
//  • smtp: gửi qua bất kỳ dịch vụ SMTP nào (SMTP_URL). LƯU Ý: web service gói miễn phí của
//    Render chặn mọi cổng SMTP — ở đó dùng `resend`.
//  • resend: gửi qua HTTP API của Resend (cổng 443, không bị chặn).
//  • brevo: gửi qua HTTP API của Brevo (cổng 443). Gói miễn phí 300 thư/ngày và cho gửi bằng 1
//    địa chỉ đã xác minh (VD Gmail của bạn) mà không cần tên miền riêng — Resend thì bắt buộc.
// Test truyền vào mailer giả để kiểm tra nội dung email mà không gửi thật.
export function createMailer(
  { driver, smtpUrl, resendApiKey, brevoApiKey, from, logBody = true },
  { fetchImpl = globalThis.fetch, log = console.log } = {},
) {
  if (driver === 'smtp') {
    const transport = nodemailer.createTransport(smtpUrl)
    return { send: (msg) => transport.sendMail({ from, ...msg }) }
  }
  if (driver === 'resend') {
    return {
      async send({ to, subject, text, html }) {
        const res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}) }),
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`Resend trả lỗi ${res.status}: ${detail.slice(0, 300)}`)
        }
      },
    }
  }
  if (driver === 'brevo') {
    const sender = parseAddress(from)
    return {
      async send({ to, subject, text, html }) {
        const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': brevoApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            sender,
            to: [{ email: to }],
            subject,
            textContent: text,
            ...(html ? { htmlContent: html } : {}),
          }),
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`Brevo trả lỗi ${res.status}: ${detail.slice(0, 300)}`)
        }
      },
    }
  }
  return {
    async send({ to, subject, text }) {
      if (logBody) log(`\n[mail] Tới: ${to}\n[mail] Tiêu đề: ${subject}\n${text}\n`)
      else log(`[mail] CHƯA GỬI (MAIL_DRIVER=console) tới ${maskEmail(to)}: "${subject}" — nội dung được ẩn khỏi log`)
    },
  }
}

// an.nguyen@example.com → a***@example.com
export function maskEmail(email) {
  const at = String(email).lastIndexOf('@')
  return at > 0 ? `${email[0]}***${email.slice(at)}` : '***'
}

// "Từ Vựng <ban@gmail.com>" → { name: 'Từ Vựng', email: 'ban@gmail.com' }; "ban@gmail.com" → { email }
export function parseAddress(address) {
  const m = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(String(address))
  if (!m) return { email: String(address).trim() }
  const name = m[1].replace(/^"(.*)"$/, '$1')
  return name ? { name, email: m[2] } : { email: m[2] }
}
