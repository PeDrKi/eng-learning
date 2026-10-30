import { z } from 'zod'

// Toàn bộ cấu hình đọc từ biến môi trường, kiểm tra 1 lần lúc khởi động: thiếu/sai là dừng
// ngay với thông báo rõ ràng, thay vì chạy được nửa chừng rồi lỗi khó hiểu lúc có request.

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'Thiếu DATABASE_URL'),
  // Kết nối TRỰC TIẾP tới Postgres, chỉ dùng cho migration (cần advisory lock theo phiên kết nối,
  // không chạy được qua connection pooler). Bỏ trống → dùng DATABASE_URL. Khi chạy nhiều instance,
  // đặt DATABASE_URL = chuỗi QUA pooler và biến này = chuỗi trực tiếp (xem SCALING.md).
  DATABASE_URL_DIRECT: z.string().optional(),
  // Số kết nối DB tối đa của MỖI instance. Tổng (số instance × giá trị này) phải nhỏ hơn giới
  // hạn kết nối của database/pooler.
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  // Múi giờ để chia "ngày" trong số liệu tổng quan của super admin (tên IANA).
  REPORT_TIME_ZONE: z
    .string()
    .default('Asia/Ho_Chi_Minh')
    .refine((tz) => {
      try {
        Intl.DateTimeFormat('en', { timeZone: tz })
        return true
      } catch {
        return false
      }
    }, 'REPORT_TIME_ZONE phải là tên múi giờ IANA hợp lệ, VD Asia/Ho_Chi_Minh.'),

  // Ghi log 1 dòng JSON cho mỗi request (mặc định: bật, trừ khi chạy test).
  REQUEST_LOG: bool.optional(),
  // Request chậm hơn ngưỡng này (ms) được đánh dấu "slow": true trong log.
  SLOW_REQUEST_MS: z.coerce.number().int().positive().default(1000),
  // Xoá nhật ký ôn tập cũ hơn N ngày khi dọn dẹp định kỳ. 0 = giữ mãi (mặc định). App chỉ dùng
  // 90 ngày gần nhất, nên khi bảng review_log quá lớn có thể đặt VD 400.
  REVIEW_LOG_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET cần tối thiểu 32 ký tự ngẫu nhiên'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 phút
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SESSION_MAX_DAYS: z.coerce.number().int().positive().default(90), // hạn tuyệt đối kể từ lúc đăng nhập
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  // Thời gian phản hồi TỐI THIỂU của POST /auth/forgot-password, /auth/resend-verification và
  // /auth/register khi bật xác nhận email (ms). Email có tồn tại hay không
  // đều chờ đủ mức này → không dò được email nào đã đăng ký qua độ trễ. 0 = tắt.
  PASSWORD_RESET_MIN_RESPONSE_MS: z.coerce.number().int().min(0).max(10_000).default(500),

  // Các domain FE được phép gọi API (cách nhau bởi dấu phẩy), VD: http://localhost:5173
  CORS_ORIGINS: csv.default(['http://localhost:5173']),
  // URL gốc của FE — dùng để dựng link đặt lại mật khẩu trong email.
  APP_URL: z.string().url().default('http://localhost:5173'),

  // Cookie refresh token. Mặc định: Secure khi production. SameSite xem giải thích ở README.
  COOKIE_SECURE: bool.optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  // Số tầng proxy đứng trước app (Fly = 1) — để req.ip là IP thật của người dùng,
  // cần cho rate limit. Không dùng trên Render: xem CLIENT_IP_HEADER.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  // Header chứa IP thật do proxy ngoài cùng gắn mà người dùng không giả được, VD Cloudflare
  // `cf-connecting-ip`. Có header này thì req.ip lấy từ đây thay vì đếm tầng X-Forwarded-For.
  // Bỏ trống: chạy trên Render (Render tự đặt biến RENDER) thì mặc định `cf-connecting-ip`, nơi
  // khác thì không dùng. Đặt chuỗi rỗng để tắt hẳn.
  CLIENT_IP_HEADER: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]*$/, 'chỉ gồm chữ, số, dấu gạch ngang')
    .optional(),
  RENDER: z.string().optional(),
  RATE_LIMIT_ENABLED: bool.default(true),

  // Hạn mức dữ liệu mỗi tài khoản (chống nhồi dữ liệu làm đầy DB) — xem lib/quotas.js.
  QUOTA_WORDS: z.coerce.number().int().positive().default(20_000),
  QUOTA_DECKS: z.coerce.number().int().positive().default(500),
  QUOTA_PHRASES: z.coerce.number().int().positive().default(5_000),
  QUOTA_COLLOCATIONS: z.coerce.number().int().positive().default(5_000),
  QUOTA_READINGS: z.coerce.number().int().positive().default(500),
  QUOTA_GROUPS: z.coerce.number().int().positive().default(50), // số nhóm 1 người tham gia

  // Thông báo đẩy "nhắc học" (Web Push). Tạo cặp khoá VAPID một lần bằng:
  //   node -e "console.log(require('web-push').generateVAPIDKeys())"
  // Thiếu khoá → tính năng tự TẮT (API trả 503, việc gửi không chạy), app vẫn hoạt động bình thường.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  // Địa chỉ liên hệ gửi kèm mỗi lần đẩy, để dịch vụ push của trình duyệt biết liên hệ ai khi có
  // sự cố. Phải là mailto: hoặc https:.
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),

  // Xác nhận email khi đăng ký bằng email + mật khẩu:
  //   off      = như cũ: đăng ký xong dùng được ngay (mặc định).
  //   required = gửi email chứa link xác nhận; bấm link mới đăng nhập được. Cần dịch vụ email
  //              thật (MAIL_DRIVER smtp/resend/brevo) — production mà MAIL_DRIVER=console thì không
  //              chạy, vì người đăng ký mới sẽ không bao giờ nhận được link.
  EMAIL_VERIFICATION: z.enum(['off', 'required']).default('off'),
  EMAIL_VERIFY_TTL_HOURS: z.coerce.number().int().positive().max(720).default(24),

  // console = in ra log (phát triển) | smtp = gửi qua SMTP | resend / brevo = gửi qua HTTP API.
  // Web service GÓI MIỄN PHÍ của Render chặn mọi cổng SMTP (25/465/587) → dùng `brevo` (gửi được
  // bằng Gmail đã xác minh, không cần tên miền) hoặc `resend` (cần tên miền riêng).
  MAIL_DRIVER: z.enum(['console', 'smtp', 'resend', 'brevo']).default('console'),
  SMTP_URL: z.string().optional(), // VD: smtps://user:pass@smtp.example.com:465
  RESEND_API_KEY: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Từ Vựng <no-reply@localhost>'),
})

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`)
    throw new Error('Cấu hình không hợp lệ:\n' + lines.join('\n'))
  }
  const e = parsed.data
  if (e.MAIL_DRIVER === 'smtp' && !e.SMTP_URL) {
    throw new Error('Cấu hình không hợp lệ:\n  • SMTP_URL: bắt buộc khi MAIL_DRIVER=smtp')
  }
  if (e.MAIL_DRIVER === 'resend' && !e.RESEND_API_KEY) {
    throw new Error('Cấu hình không hợp lệ:\n  • RESEND_API_KEY: bắt buộc khi MAIL_DRIVER=resend')
  }
  if (e.MAIL_DRIVER === 'brevo' && !e.BREVO_API_KEY) {
    throw new Error('Cấu hình không hợp lệ:\n  • BREVO_API_KEY: bắt buộc khi MAIL_DRIVER=brevo')
  }
  if (e.EMAIL_VERIFICATION === 'required' && e.MAIL_DRIVER === 'console' && e.NODE_ENV === 'production') {
    throw new Error(
      'Cấu hình không hợp lệ:\n  • EMAIL_VERIFICATION=required cần MAIL_DRIVER=smtp, resend hoặc brevo (console không gửi email thật)',
    )
  }
  if (e.COOKIE_SAMESITE === 'none' && e.COOKIE_SECURE === false) {
    throw new Error('Cấu hình không hợp lệ:\n  • COOKIE_SAMESITE=none bắt buộc COOKIE_SECURE=true')
  }
  const isProd = e.NODE_ENV === 'production'

  return {
    env: e.NODE_ENV,
    isProd,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    dbPoolMax: e.DB_POOL_MAX,
    reportTimeZone: e.REPORT_TIME_ZONE,
    requestLog: e.REQUEST_LOG ?? e.NODE_ENV !== 'test',
    slowRequestMs: e.SLOW_REQUEST_MS,
    reviewLogRetentionDays: e.REVIEW_LOG_RETENTION_DAYS,
    auth: {
      accessSecret: e.JWT_ACCESS_SECRET,
      accessTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
      sessionMaxDays: e.SESSION_MAX_DAYS,
      resetTtlMinutes: e.PASSWORD_RESET_TTL_MINUTES,
      resetMinResponseMs: e.PASSWORD_RESET_MIN_RESPONSE_MS,
      emailVerification: e.EMAIL_VERIFICATION === 'required',
      verifyTtlHours: e.EMAIL_VERIFY_TTL_HOURS,
    },
    cors: { origins: e.CORS_ORIGINS },
    appUrl: e.APP_URL.replace(/\/+$/, ''),
    cookie: {
      secure: e.COOKIE_SECURE ?? (isProd || e.COOKIE_SAMESITE === 'none'),
      sameSite: e.COOKIE_SAMESITE,
    },
    trustProxy: e.TRUST_PROXY,
    clientIpHeader: e.CLIENT_IP_HEADER ?? (e.RENDER ? 'cf-connecting-ip' : ''),
    rateLimitEnabled: e.RATE_LIMIT_ENABLED,
    quotas: {
      words: e.QUOTA_WORDS,
      decks: e.QUOTA_DECKS,
      phrases: e.QUOTA_PHRASES,
      collocations: e.QUOTA_COLLOCATIONS,
      readings: e.QUOTA_READINGS,
      groups: e.QUOTA_GROUPS,
    },
    mail: {
      driver: e.MAIL_DRIVER,
      smtpUrl: e.SMTP_URL,
      resendApiKey: e.RESEND_API_KEY,
      brevoApiKey: e.BREVO_API_KEY,
      from: e.MAIL_FROM,
      logBody: !isProd, // production: driver console không in nội dung email (có link đặt lại mật khẩu)
    },
    push: {
      // Bật khi có ĐỦ cả 2 khoá — thiếu một nửa thì coi như chưa cấu hình, không nửa vời.
      enabled: Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY),
      publicKey: e.VAPID_PUBLIC_KEY || '',
      privateKey: e.VAPID_PRIVATE_KEY || '',
      subject: e.VAPID_SUBJECT,
    },
  }
}
