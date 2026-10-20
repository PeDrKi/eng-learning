import { pathToFileURL } from 'node:url'

// Dọn dữ liệu hết hạn — giữ cho các bảng "chỉ thêm" không phình mãi khi số người dùng tăng.
// Mọi lệnh đều AN TOÀN khi chạy lặp lại và khi nhiều instance cùng chạy (chỉ xoá dòng đã hết
// tác dụng), nên không cần khoá hay bộ lập lịch riêng: server tự gọi lúc khởi động và mỗi 24 giờ
// (xem server.js). Chạy tay: `npm run cleanup`.
//
//   • refresh_tokens đã HẾT HẠN — không dùng được nữa. (Token bị thu hồi nhưng còn hạn thì GIỮ:
//     cần để phát hiện token bị đánh cắp dùng lại.)
//   • password_reset_tokens, email_verification_tokens hết hạn quá 1 ngày.
//   • review_log cũ hơn `reviewLogRetentionDays` ngày — CHỈ khi được cấu hình (> 0). Mặc định
//     giữ mãi, vì đây là dữ liệu của người dùng.
export async function runCleanup(pool, { reviewLogRetentionDays = 0 } = {}) {
  const deleted = {}
  const run = async (name, sql, params = []) => {
    const { rowCount } = await pool.query(sql, params)
    deleted[name] = rowCount
  }
  await run('refresh_tokens', 'delete from refresh_tokens where expires_at < now()')
  await run('password_reset_tokens', "delete from password_reset_tokens where expires_at < now() - interval '1 day'")
  await run(
    'email_verification_tokens',
    "delete from email_verification_tokens where expires_at < now() - interval '1 day'",
  )
  if (reviewLogRetentionDays > 0) {
    await run('review_log', "delete from review_log where reviewed_at < now() - $1 * interval '1 day'", [
      reviewLogRetentionDays,
    ])
  }
  return deleted
}

// Chạy trực tiếp: `npm run cleanup`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('dotenv/config')
  const { loadConfig } = await import('../config.js')
  const { createPool } = await import('../db/pool.js')
  const config = loadConfig()
  const pool = createPool(config.databaseUrl, { max: 1 })
  try {
    console.log('[cleanup]', JSON.stringify(await runCleanup(pool, config)))
  } finally {
    await pool.end()
  }
}
