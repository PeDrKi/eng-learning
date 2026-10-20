// Mẫu email gửi cho người dùng: mỗi email có 2 bản — HTML (giao diện đẹp, có nút bấm) và chữ
// thuần (cho ứng dụng email không hiện HTML, và để log/test đọc được). Bố cục dùng bảng + style
// viết thẳng vào thẻ vì nhiều ứng dụng email (Gmail, Outlook) bỏ qua <style> và CSS hiện đại.
// Màu lấy theo giao diện app (nền kem, chữ xanh đậm, điểm nhấn vàng đồng).

const APP_NAME = 'Từ Vựng'
const C = {
  page: '#f4efe4',
  card: '#ffffff',
  border: '#e6dcc6',
  text: '#1f2a44',
  muted: '#5f6675',
  gold: '#8a6a1f',
  button: '#1f2a44',
  buttonText: '#ffffff',
}
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const SERIF = "Georgia, 'Times New Roman', serif"

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// Đoạn văn: chuỗi thường, hoặc mảng các phần { text } / { strong } để in đậm 1 phần (VD email).
const toText = (p) => (Array.isArray(p) ? p.map((x) => x.text ?? x.strong).join('') : p)
const toHtml = (p) =>
  Array.isArray(p)
    ? p.map((x) => (x.strong != null ? `<strong>${escapeHtml(x.strong)}</strong>` : escapeHtml(x.text))).join('')
    : escapeHtml(p)

// { preheader, heading, greeting, intro: [đoạn], button: { label, url }, after: [đoạn], note }
export function renderEmail({ preheader, heading, greeting, intro = [], button, after = [], note }) {
  const paragraph = (p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.text};">${toHtml(p)}</p>`

  const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${C.card};border:1px solid ${C.border};border-radius:12px;">
<tr><td style="padding:36px 32px 8px;font-family:${FONT};">
<div style="font-family:${SERIF};font-size:13px;letter-spacing:3px;text-transform:uppercase;color:${C.gold};margin:0 0 12px;">${APP_NAME}</div>
<h1 style="font-family:${SERIF};font-size:26px;line-height:1.25;font-weight:bold;color:${C.text};margin:0 0 24px;">${escapeHtml(heading)}</h1>
${paragraph(greeting)}
${intro.map(paragraph).join('\n')}
${
  button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>
<td style="border-radius:8px;background:${C.button};">
<a href="${escapeHtml(button.url)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:bold;color:${C.buttonText};text-decoration:none;border-radius:8px;">${escapeHtml(button.label)}</a>
</td></tr></table>`
    : ''
}
${after.map(paragraph).join('\n')}
${
  button
    ? `<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:${C.muted};">Nếu nút không hoạt động, hãy sao chép liên kết sau và dán vào trình duyệt:</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${escapeHtml(button.url)}" target="_blank" style="color:${C.gold};">${escapeHtml(button.url)}</a></p>`
    : ''
}
${note ? `<p style="margin:0 0 24px;padding:14px 16px;background:${C.page};border-radius:8px;font-size:13px;line-height:1.55;color:${C.muted};">${toHtml(note)}</p>` : ''}
<p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:${C.text};">Trân trọng,<br>Đội ngũ ${APP_NAME}</p>
</td></tr>
</table>
<p style="max-width:520px;margin:16px auto 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted};text-align:center;">
Email này được gửi tự động, vui lòng không trả lời.<br>${APP_NAME} · Ứng dụng học từ vựng tiếng Anh
</p>
</td></tr>
</table>
</body>
</html>`

  const text = [
    greeting,
    ...intro.map(toText),
    ...(button ? [`${button.label}:\n${button.url}`] : []),
    ...after.map(toText),
    ...(note ? [toText(note)] : []),
    `Trân trọng,\nĐội ngũ ${APP_NAME}`,
    '—\nEmail này được gửi tự động, vui lòng không trả lời.',
  ].join('\n\n')

  return { html, text }
}

const greet = (name) => (name ? `Xin chào ${name},` : 'Xin chào,')

export function verificationEmail({ email, name, link, ttlHours }) {
  return {
    subject: `Xác nhận địa chỉ email của bạn – ${APP_NAME}`,
    ...renderEmail({
      preheader: `Chỉ còn một bước để kích hoạt tài khoản ${APP_NAME} của bạn.`,
      heading: 'Xác nhận địa chỉ email',
      greeting: greet(name),
      intro: [
        `Cảm ơn bạn đã đăng ký ${APP_NAME}. Để hoàn tất việc tạo tài khoản và bảo vệ thông tin của bạn, vui lòng xác nhận địa chỉ email dưới đây thuộc về bạn:`,
        [{ strong: email }],
      ],
      button: { label: 'Xác nhận email', url: link },
      after: [
        `Liên kết có hiệu lực trong ${ttlHours} giờ và chỉ dùng được một lần. Sau khi xác nhận, bạn sẽ được đăng nhập ngay để bắt đầu học.`,
      ],
      note: `Nếu bạn không đăng ký tài khoản ${APP_NAME}, bạn có thể yên tâm bỏ qua email này — tài khoản sẽ không được kích hoạt và địa chỉ email của bạn sẽ không được sử dụng.`,
    }),
  }
}

export function alreadyRegisteredEmail({ email, appUrl }) {
  return {
    subject: `Email của bạn đã có tài khoản ${APP_NAME}`,
    ...renderEmail({
      preheader: 'Có yêu cầu đăng ký mới bằng địa chỉ email đã có tài khoản.',
      heading: 'Bạn đã có tài khoản',
      greeting: greet(),
      intro: [
        [
          { text: `Chúng tôi vừa nhận được yêu cầu đăng ký ${APP_NAME} bằng địa chỉ ` },
          { strong: email },
          { text: '. Địa chỉ này đã có tài khoản, vì vậy không có tài khoản mới nào được tạo.' },
        ],
        'Bạn có thể đăng nhập bằng tài khoản hiện có. Nếu quên mật khẩu, hãy chọn "Quên mật khẩu?" ở màn hình đăng nhập để nhận liên kết đặt mật khẩu mới.',
      ],
      button: { label: 'Đến trang đăng nhập', url: appUrl },
      note: 'Nếu không phải bạn thực hiện yêu cầu này, bạn có thể bỏ qua email này — tài khoản của bạn không bị thay đổi gì.',
    }),
  }
}

export function passwordResetEmail({ email, link, ttlMinutes }) {
  return {
    subject: `Đặt lại mật khẩu – ${APP_NAME}`,
    ...renderEmail({
      preheader: `Liên kết đặt mật khẩu mới cho tài khoản ${APP_NAME} của bạn.`,
      heading: 'Đặt lại mật khẩu',
      greeting: greet(),
      intro: [
        [
          { text: 'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản ' },
          { strong: email },
          { text: '. Bấm nút bên dưới để chọn mật khẩu mới.' },
        ],
      ],
      button: { label: 'Đặt mật khẩu mới', url: link },
      after: [
        `Liên kết có hiệu lực trong ${ttlMinutes} phút và chỉ dùng được một lần. Sau khi đổi mật khẩu, các thiết bị khác đang đăng nhập sẽ được đăng xuất để bảo đảm an toàn.`,
      ],
      note: 'Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này — mật khẩu hiện tại của bạn vẫn được giữ nguyên.',
    }),
  }
}
