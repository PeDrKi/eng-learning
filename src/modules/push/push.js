import { Router } from 'express'
import { z } from 'zod'
import { HttpError } from '../../lib/httpError.js'
import { validateBody } from '../../middleware/validate.js'
import { createSender, deliverToUser } from './deliver.js'

// Đăng ký nhận nhắc học qua thông báo đẩy (Web Push).
//
// Mỗi THIẾT BỊ/trình duyệt một đăng ký: người học bật nhắc trên điện thoại thì chỉ điện thoại đó
// nhận, bật thêm trên máy tính thì cả hai cùng nhận. `endpoint` do trình duyệt cấp, duy nhất toàn
// cục — dùng làm khoá để đăng ký lại trên cùng máy không sinh dòng rác.
//
// Khoá công khai (VAPID) được phục vụ qua API chứ không nhúng lúc build: đổi khoá chỉ cần đổi biến
// môi trường ở backend rồi khởi động lại, không phải build lại frontend.

// Server sẽ tự gửi request tới `endpoint` này (lúc nhắc học) → chỉ nhận địa chỉ HTTPS của các dịch
// vụ đẩy thật của trình duyệt. Không thì kẻ xấu đăng ký endpoint trỏ vào mạng nội bộ của server
// (VD http://169.254.169.254/, *.internal) để server gọi hộ (SSRF).
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge, Android
  'android.googleapis.com',
  'push.services.mozilla.com', // Firefox
  'notify.windows.com', // Edge bản cũ (WNS)
  'push.apple.com', // Safari / iOS
]
export function isPushServiceUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  const host = url.hostname.toLowerCase()
  return PUSH_SERVICE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}
const pushEndpoint = z
  .url('endpoint không hợp lệ.')
  .max(2000, 'endpoint quá dài.')
  .refine(isPushServiceUrl, 'endpoint không phải dịch vụ thông báo đẩy được hỗ trợ.')

const subscriptionSchema = z.object({
  endpoint: pushEndpoint,
  keys: z.object({
    p256dh: z.string().min(1, 'Thiếu khoá p256dh.').max(255),
    auth: z.string().min(1, 'Thiếu khoá auth.').max(255),
  }),
})

// Nội dung thông báo thử. Nói rõ đây là thông báo thử để người dùng không tưởng là đã tới giờ ôn.
const TEST_PAYLOAD = JSON.stringify({
  title: 'Thông báo thử — Từ Vựng',
  body: 'Nếu bạn thấy thông báo này thì nhắc học đã chạy được trên máy này.',
  url: '/',
  test: true,
})

const notConfigured = () =>
  new HttpError(503, 'push_not_configured', 'Máy chủ chưa bật tính năng nhắc học (thiếu khoá VAPID).')

export function createPushRouter({ pool, config }) {
  const router = Router()

  // FE gọi trước khi đăng ký để lấy khoá công khai. Trả cả cờ `enabled` để FE ẩn hẳn nút bật nhắc
  // khi máy chủ chưa cấu hình, thay vì để người dùng bật rồi mới báo lỗi.
  router.get('/public-key', (_req, res) => {
    res.json({ enabled: config.push.enabled, public_key: config.push.publicKey })
  })

  router.post('/subscribe', validateBody(subscriptionSchema), async (req, res) => {
    if (!config.push.enabled) throw notConfigured()
    const { endpoint, keys } = req.body
    const userAgent = String(req.get('user-agent') || '').slice(0, 300)
    // Cùng endpoint mà đổi tài khoản (2 người dùng chung máy) → chuyển đăng ký sang người mới.
    await pool.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update
         set user_id = excluded.user_id, p256dh = excluded.p256dh,
             auth = excluded.auth, user_agent = excluded.user_agent`,
      [req.user.id, endpoint, keys.p256dh, keys.auth, userAgent],
    )
    res.status(201).json({ ok: true })
  })

  // Tắt nhắc trên đúng thiết bị này. Không báo lỗi nếu đăng ký đã không còn — kết quả mong muốn
  // (thiết bị này không nhận nhắc nữa) đã đạt được.
  router.post(
    '/unsubscribe',
    validateBody(z.object({ endpoint: z.url('endpoint không hợp lệ.') })),
    async (req, res) => {
      await pool.query('delete from push_subscriptions where endpoint = $1 and user_id = $2', [
        req.body.endpoint,
        req.user.id,
      ])
      res.status(204).end()
    },
  )

  // "Gửi thử" trong Cài đặt. Không có nút này thì người dùng bật nhắc rồi phải ĐỢI tới giờ mới
  // biết nó có chạy hay không — mà trên máy tính có cả chục thứ chặn thông báo (Windows Focus
  // Assist, Chrome tắt thông báo nền, quyền bị chặn từ trước). Gửi thử đi qua ĐÚNG đường mà lời
  // nhắc thật đi (deliver.js), nên thấy được thông báo là bằng chứng cả chuỗi đang hoạt động.
  router.post('/test', async (req, res) => {
    if (!config.push.enabled) throw notConfigured()
    const send = createSender(config)
    const result = await deliverToUser(pool, send, req.user.id, TEST_PAYLOAD)
    if (result.sent === 0) {
      // Không còn đăng ký nào (hoặc tất cả đã chết) → báo rõ thay vì trả 200 "ok" lừa người dùng.
      throw new HttpError(
        409,
        'no_active_subscription',
        'Máy này chưa đăng ký nhận nhắc, hoặc đăng ký đã hết hiệu lực. Hãy tắt rồi bật lại.',
      )
    }
    res.json(result)
  })

  return router
}
