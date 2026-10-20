import 'dotenv/config'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { runCleanup } from './jobs/cleanup.js'
import { createMailer } from './lib/mailer.js'

let config
try {
  config = loadConfig()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

const pool = createPool(config.databaseUrl, { max: config.dbPoolMax })
const app = createApp({ config, pool, mailer: createMailer(config.mail) })

// 0.0.0.0 (không phải localhost) để proxy của Render truy cập được vào app.
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] tuvung-api chạy ở cổng ${config.port} (${config.env})`)
})

// Dọn dữ liệu hết hạn lúc khởi động rồi mỗi 24 giờ. Chạy nền, lỗi chỉ ghi log — không được làm
// chậm hay làm sập việc phục vụ request. Nhiều instance cùng chạy cũng không sao (xem jobs/cleanup.js).
const cleanup = () =>
  runCleanup(pool, config)
    .then((deleted) => console.log('[cleanup]', JSON.stringify(deleted)))
    .catch((err) => console.error('[cleanup] Lỗi:', err.message))
setTimeout(cleanup, 30_000).unref()
setInterval(cleanup, 24 * 60 * 60_000).unref()

// Khi deploy bản mới, Render gửi SIGTERM cho bản cũ: ngừng nhận request mới, chờ các request
// đang xử lý xong, đóng pool DB rồi mới thoát.
function shutdown(signal) {
  console.log(`[server] Nhận ${signal}, đang dừng...`)
  server.close(async () => {
    await pool.end().catch(() => {})
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 25_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
