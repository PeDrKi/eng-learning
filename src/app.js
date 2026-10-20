import compression from 'compression'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { createAuthRouter } from './modules/auth/auth.routes.js'
import { createAuthService } from './modules/auth/auth.service.js'
import { createChaptersRouter } from './modules/chapters/chapters.routes.js'
import { createChaptersService } from './modules/chapters/chapters.service.js'
import { createDecksRouter } from './modules/decks/decks.routes.js'
import { createDecksService } from './modules/decks/decks.service.js'
import { createWordsRouter } from './modules/words/words.routes.js'
import { createWordsService } from './modules/words/words.service.js'
import { createGroupsRouter } from './modules/groups/groups.routes.js'
import { createGroupsService } from './modules/groups/groups.service.js'
import { createPhrasesRouter } from './modules/phrases/phrases.routes.js'
import { createPhrasesService } from './modules/phrases/phrases.service.js'
import { createProgressRouter } from './modules/progress/progress.routes.js'
import { createProgressService } from './modules/progress/progress.service.js'
import { createReviewLogRouter } from './modules/reviewLog/reviewLog.routes.js'
import { createReviewLogService } from './modules/reviewLog/reviewLog.service.js'
import { createSettingsRouter } from './modules/settings/settings.js'
import { createPushRouter } from './modules/push/push.js'
import { createAdminRouter } from './modules/admin/admin.routes.js'
import { createAdminService } from './modules/admin/admin.service.js'
import { createApiLimiter, createJoinLimiter } from './middleware/rateLimits.js'
import { requestLog } from './middleware/requestLog.js'
import { requireActiveUser, requireSuperAdmin } from './middleware/requireActiveUser.js'
import { requireAuth } from './middleware/requireAuth.js'

// Dựng app Express từ các phụ thuộc truyền vào (config, pool DB, mailer) thay vì tự đọc
// biến môi trường/tự kết nối DB — nhờ vậy test dựng được app với DB test + mailer giả.
//
// `rateLimitStore` (tuỳ chọn): hàm `(prefix) => store` tạo kho đếm DÙNG CHUNG cho bộ giới hạn số
// request khi chạy nhiều instance. Bỏ trống = đếm trong bộ nhớ của process (đúng với 1 instance).
export function createApp({ config, pool, mailer, rateLimitStore, log = console.log }) {
  const app = express()
  app.set('trust proxy', config.trustProxy)
  // App không giữ trạng thái nào trong bộ nhớ giữa các request (phiên nằm ở JWT + bảng
  // refresh_tokens) → chạy bao nhiêu instance sau load balancer cũng được. Xem SCALING.md.

  app.use(requestLog({ enabled: config.requestLog, slowMs: config.slowRequestMs, log }))
  // Nén phản hồi (gzip/brotli): danh sách vài nghìn từ nén còn ~1/5-1/8 dung lượng.
  app.use(compression())

  app.use(helmet())
  app.use(cors({ origin: config.cors.origins, credentials: true, maxAge: 600 }))
  app.use(express.json({ limit: '2mb' }))
  app.use(cookieParser())

  // Render gọi /health liên tục để biết app còn sống và bản deploy mới đã sẵn sàng chưa.
  // CỐ Ý không truy vấn DB ở đây: nếu mỗi lần kiểm tra đều chạm DB, database kiểu "tự ngủ khi
  // rảnh" (Neon) sẽ không bao giờ được ngủ → tốn hết giờ tính toán miễn phí. Kết nối DB đã được
  // kiểm tra lúc khởi động (bước migrate chạy trước server). Kiểm tra DB thủ công: /health/db.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
  app.get('/health/db', async (_req, res) => {
    try {
      await pool.query('select 1')
      res.json({ status: 'ok', database: 'ok' })
    } catch {
      res.status(503).json({ status: 'error', database: 'unreachable' })
    }
  })

  const authService = createAuthService({ pool, config, mailer })
  // Đăng nhập hợp lệ (JWT) + tài khoản còn tồn tại và không bị khoá (đọc DB mỗi request, nên khoá
  // tài khoản / đổi vai trò có hiệu lực ngay). Gắn req.user = { id, email, role }.
  const requireUser = [requireAuth(config), requireActiveUser(pool)]
  // Endpoint dữ liệu: thêm giới hạn số request theo tài khoản (chống gọi dồn dập).
  const auth = [...requireUser, createApiLimiter(config.rateLimitEnabled, rateLimitStore)]
  app.use('/auth', createAuthRouter({ config, authService, requireUser, rateLimitStore }))

  // Từ đây trở xuống: mọi endpoint dữ liệu đều bắt buộc đăng nhập.
  app.use('/decks', auth, createDecksRouter({ decksService: createDecksService({ pool, quotas: config.quotas }) }))
  app.use(
    '/chapters',
    auth,
    createChaptersRouter({ chaptersService: createChaptersService({ pool, quotas: config.quotas }) }),
  )
  app.use('/words', auth, createWordsRouter({ wordsService: createWordsService({ pool, quotas: config.quotas }) }))
  app.use('/progress', auth, createProgressRouter({ progressService: createProgressService({ pool }) }))
  app.use('/review-log', auth, createReviewLogRouter({ reviewLogService: createReviewLogService({ pool }) }))
  app.use('/settings', auth, createSettingsRouter({ pool }))
  app.use('/push', auth, createPushRouter({ pool, config }))
  app.use(
    '/groups',
    auth,
    createGroupsRouter({
      groupsService: createGroupsService({ pool, quotas: config.quotas }),
      joinLimiter: createJoinLimiter(config.rateLimitEnabled, rateLimitStore),
    }),
  )
  app.use(
    '/phrases',
    auth,
    createPhrasesRouter({ phrasesService: createPhrasesService({ pool, quotas: config.quotas }) }),
  )

  // Quản trị tài khoản — chỉ super admin.
  app.use(
    '/admin',
    auth,
    requireSuperAdmin,
    createAdminRouter({
      adminService: createAdminService({
        pool,
        log: config.env === 'test' ? () => {} : console.log,
        timeZone: config.reportTimeZone,
        overviewCacheMs: config.env === 'test' ? 0 : 60_000,
      }),
    }),
  )

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
