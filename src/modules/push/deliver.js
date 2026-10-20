import webpush from 'web-push'

// Gửi một thông báo tới MỌI thiết bị của một người dùng, và dọn những đăng ký đã chết.
//
// Dùng chung cho hai nơi: việc nhắc hằng ngày (src/jobs/sendReminders.js) và nút "Gửi thử" trong
// Cài đặt (POST /push/test). Tách ra để hai đường đi KHÔNG lệch nhau — nếu "gửi thử" chạy bằng mã
// khác với lúc nhắc thật, thử thành công vẫn không chứng minh được điều gì.

export function createSender(config) {
  return (sub, payload) =>
    webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
      vapidDetails: {
        subject: config.push.subject,
        publicKey: config.push.publicKey,
        privateKey: config.push.privateKey,
      },
    })
}

/**
 * @returns {{sent:number, failed:number, removed:number}}
 */
export async function deliverToUser(pool, send, userId, payload) {
  const { rows: subs } = await pool.query('select endpoint, p256dh, auth from push_subscriptions where user_id = $1', [
    userId,
  ])
  const result = { sent: 0, failed: 0, removed: 0 }
  for (const sub of subs) {
    try {
      await send(sub, payload)
      result.sent += 1
    } catch (err) {
      result.failed += 1
      // 404/410 = người dùng đã gỡ app, xoá dữ liệu trang, hoặc thu hồi quyền → đăng ký chết hẳn,
      // xoá đi. Lỗi khác (mạng, 5xx của dịch vụ push) thì GIỮ lại để lần sau thử tiếp.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await pool.query('delete from push_subscriptions where endpoint = $1', [sub.endpoint])
        result.removed += 1
      }
    }
  }
  return result
}
