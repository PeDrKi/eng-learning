import { pathToFileURL } from 'node:url'
import { createSender, deliverToUser } from '../modules/push/deliver.js'

// Gửi nhắc học hằng ngày. Chạy MỖI GIỜ (cron trên Render — xem render.yaml và DEPLOY.md).
//
// Chỉ nhắc khi cả ba điều kiện đều đúng:
//   1. Đang đúng GIỜ người đó chọn, tính theo MÚI GIỜ CỦA HỌ (reminder_tz), không phải giờ máy chủ.
//   2. Hôm nay (theo giờ của họ) họ CHƯA ôn lượt nào.
//   3. Họ CÓ thẻ đến hạn — nhắc khi không có gì để ôn là làm phiền vô cớ.
//
// Nhắc người đã học xong, hoặc nhắc khi chẳng có gì để làm, là cách nhanh nhất khiến người dùng
// tắt thông báo vĩnh viễn — lúc đó mất luôn cả những lời nhắc có ích về sau.
//
// `reminder_sent_at` chặn gửi trùng: việc này chạy mỗi giờ, và một lần chạy chậm/chạy lại không
// được phép nhắc hai lần trong cùng một ngày.

// Khoảng cách tối thiểu giữa 2 lần nhắc. 20 giờ (không phải 24) để lần nhắc hôm sau không bị bỏ
// lỡ chỉ vì hôm nay gửi muộn vài phút.
const MIN_HOURS_BETWEEN = 20

// Ai đang đến giờ được nhắc. Trả về cả danh sách đăng ký (thiết bị) của từng người.
export const DUE_USERS_SQL = `
  select u.id as user_id,
         s.reminder_tz,
         (select count(*) from word_progress wp
           where wp.user_id = u.id and wp.due_at <= now())::int as due_count
    from users u
    join user_settings s on s.user_id = u.id
   where s.reminder_enabled
     and extract(hour from (now() at time zone s.reminder_tz)) = s.reminder_hour
     and (s.reminder_sent_at is null or s.reminder_sent_at < now() - make_interval(hours => $1))
     -- Hôm nay (theo giờ của chính họ) chưa ôn lượt nào.
     and not exists (
       select 1 from review_log r
        where r.user_id = u.id
          and (r.reviewed_at at time zone s.reminder_tz)::date = (now() at time zone s.reminder_tz)::date
     )
     and exists (select 1 from push_subscriptions p where p.user_id = u.id)
`

export function notificationPayload(dueCount) {
  return JSON.stringify({
    title: 'Tới giờ ôn từ rồi',
    body:
      dueCount >= 50
        ? `Bạn có ${dueCount} thẻ đến hạn — học một phiên ngắn thôi cũng được.`
        : `Bạn có ${dueCount} thẻ đến hạn hôm nay.`,
    url: '/',
  })
}

/**
 * @param sendOne  hàm gửi 1 thông báo — tách ra để test không cần mạng thật.
 *                 Mặc định dùng web-push với khoá VAPID trong config.
 */
export async function sendReminders(pool, config, { now = () => new Date(), sendOne } = {}) {
  if (!config.push?.enabled) return { skipped: 'push_not_configured' }

  const send = sendOne ?? createSender(config)

  const { rows: users } = await pool.query(DUE_USERS_SQL, [MIN_HOURS_BETWEEN])
  const result = { users: 0, sent: 0, failed: 0, removed: 0, skippedNothingDue: 0 }

  for (const user of users) {
    if (user.due_count === 0) {
      result.skippedNothingDue += 1
      continue
    }
    const one = await deliverToUser(pool, send, user.user_id, notificationPayload(user.due_count))
    result.sent += one.sent
    result.failed += one.failed
    result.removed += one.removed
    // Chỉ đánh dấu "đã nhắc" khi có ÍT NHẤT một thiết bị nhận được. Nếu tất cả đều lỗi (mạng,
    // dịch vụ push hỏng) thì để lần chạy sau thử lại, đừng coi như đã nhắc rồi.
    if (one.sent > 0) {
      result.users += 1
      await pool.query('update user_settings set reminder_sent_at = $2 where user_id = $1', [user.user_id, now()])
    }
  }
  return result
}

// Chạy trực tiếp: `npm run reminders` (cron gọi lệnh này mỗi giờ).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('dotenv/config')
  const { loadConfig } = await import('../config.js')
  const { createPool } = await import('../db/pool.js')
  const config = loadConfig()
  const pool = createPool(config.databaseUrl, { max: 1 })
  try {
    console.log('[reminders]', JSON.stringify(await sendReminders(pool, config)))
  } finally {
    await pool.end()
  }
}
