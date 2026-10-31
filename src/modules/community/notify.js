import { deliverToUser } from '../push/deliver.js'

// Thông báo cộng đồng: luôn ghi 1 dòng `notifications` (số chưa đọc hiện ở mục Khám phá), và gửi
// thêm Web Push tới các thiết bị người đó đã BẬT nhắc học (dùng lại đăng ký push sẵn có — chưa bật
// thì không có thiết bị nào để gửi). Gom lại: mỗi người tối đa 1 thông báo đẩy về cộng đồng mỗi
// PUSH_GAP_MINUTES phút — nhiều nhận xét dồn dập chỉ đẩy 1 lần, phần còn lại thấy trong app.
const PUSH_GAP_MINUTES = 15

const PUSH_TEXT = {
  comment: (p) => ({ title: 'Nhận xét mới', body: `Có nhận xét mới ở chủ đề "${p.deck_name}".` }),
  suggestion: (p) => ({ title: 'Đề xuất chỉnh sửa mới', body: `Có đề xuất mới chờ bạn duyệt ở "${p.deck_name}".` }),
  suggestion_result: (p) => ({
    title: p.status === 'accepted' ? 'Đề xuất được áp dụng' : 'Đề xuất bị từ chối',
    body: `Đề xuất của bạn ở "${p.deck_name}" đã được xem xét.`,
  }),
}

// send: hàm gửi push (push/deliver.js createSender) hoặc null khi máy chủ chưa cấu hình VAPID.
export function createNotifier({ pool, send, log = console.error }) {
  async function maybePush(id, userId, type, deckId, payload) {
    const { rows } = await pool.query(
      `select 1 from notifications where user_id = $1 and pushed_at > now() - make_interval(mins => $2) limit 1`,
      [userId, PUSH_GAP_MINUTES],
    )
    if (rows[0]) return
    await pool.query('update notifications set pushed_at = now() where id = $1', [id])
    const text = PUSH_TEXT[type](payload)
    await deliverToUser(pool, send, userId, JSON.stringify({ ...text, url: `/explore?deck=${deckId}` }))
  }

  // Không bao giờ làm hỏng thao tác chính: lỗi ghi/gửi thông báo chỉ được ghi log.
  return async function notify(userId, { type, deckId, actorId = null, payload = {} }) {
    if (!userId || userId === actorId) return
    try {
      const { rows } = await pool.query(
        `insert into notifications (user_id, type, deck_id, actor_id, payload) values ($1, $2, $3, $4, $5) returning id`,
        [userId, type, deckId, actorId, payload],
      )
      if (send) maybePush(rows[0].id, userId, type, deckId, payload).catch((err) => log('[notify] push:', err.message))
    } catch (err) {
      log('[notify]', err.message)
    }
  }
}
