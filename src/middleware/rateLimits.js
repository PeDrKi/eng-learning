import { rateLimit } from 'express-rate-limit'

// Giới hạn số lần gọi cho các endpoint dễ bị dò/spam.
//
// Bộ đếm mặc định lưu trong BỘ NHỚ của process — đúng khi chạy 1 instance. Chạy nhiều instance
// thì mỗi instance đếm riêng (giới hạn thực tế bị nhân lên theo số instance), nên cần kho đếm
// dùng chung: truyền `createStore` (hàm tạo 1 store của express-rate-limit, VD rate-limit-redis)
// vào createApp — xem SCALING.md. `createStore(prefix)` được gọi 1 lần cho MỖI bộ giới hạn, vì
// mỗi bộ cần store riêng với tiền tố khoá riêng.
const TOO_FAST = 'Bạn thao tác quá nhanh — vui lòng đợi một chút rồi thử lại.'

function limiter({ name, windowMs, limit, enabled, keyGenerator, createStore, message = TOO_FAST, ...options }) {
  return rateLimit({
    windowMs,
    limit,
    ...(createStore ? { store: createStore(`rl:${name}:`) } : {}),
    ...(keyGenerator ? { keyGenerator } : {}),
    ...options,
    skip: () => !enabled,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message } }),
  })
}

export function createAuthLimiters(enabled, createStore) {
  return {
    // Đăng nhập/đăng ký: 10 lần / 15 phút / IP — chặn dò mật khẩu hàng loạt.
    credentials: limiter({ name: 'credentials', windowMs: 15 * 60_000, limit: 10, enabled, createStore }),
    // Đăng nhập SAI: 10 lần / 15 phút cho MỖI EMAIL, bất kể từ bao nhiêu IP — chặn dò mật khẩu
    // 1 tài khoản bằng nhiều máy (botnet), điều giới hạn theo IP ở trên không chặn được. Chỉ
    // đếm lần sai (đăng nhập đúng không tính). Đếm cả email chưa đăng ký để câu trả lời 429
    // không tiết lộ email nào có tài khoản. Đặt SAU validateBody để email đã được chuẩn hoá
    // (trim + chữ thường) — "An@x.com " và "an@x.com" chung 1 bộ đếm.
    loginEmail: limiter({
      name: 'login-email',
      windowMs: 15 * 60_000,
      limit: 10,
      enabled,
      createStore,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => `email:${req.body.email}`,
      message: 'Email này đã nhập sai mật khẩu quá nhiều lần. Hãy đợi 15 phút hoặc dùng "Quên mật khẩu".',
    }),
    // Đăng ký: thêm 10 lần / GIỜ / IP. Khi TẮT xác nhận email, đăng ký báo "email đã có tài
    // khoản" nên có thể bị dùng để dò danh sách email; giới hạn này làm việc dò chậm đi nhiều.
    // Bật xác nhận email (EMAIL_VERIFICATION=required) thì câu trả lời luôn giống nhau.
    register: limiter({ name: 'register', windowMs: 60 * 60_000, limit: 10, enabled, createStore }),
    // Quên mật khẩu: 5 lần / giờ / IP — chặn spam email tới người khác.
    passwordReset: limiter({ name: 'password-reset', windowMs: 60 * 60_000, limit: 5, enabled, createStore }),
    // Gửi lại email xác nhận: 5 lần / giờ / IP (thêm giới hạn 1 email / phút / tài khoản ở service).
    verificationEmail: limiter({ name: 'verification-email', windowMs: 60 * 60_000, limit: 5, enabled, createStore }),
  }
}

// Giới hạn chung cho các endpoint dữ liệu (đặt SAU bước xác thực): 300 request / phút cho mỗi
// TÀI KHOẢN — rộng hơn nhiều so với dùng app bình thường (kể cả lúc đồng bộ sau khi mất mạng
// hay nhập file lớn), chỉ để chặn script gọi dồn dập làm quá tải máy chủ/database. Đếm theo
// tài khoản chứ không theo IP: nhiều người dùng chung 1 mạng (trường học, công ty) không ảnh
// hưởng lẫn nhau.
export function createApiLimiter(enabled, createStore) {
  return limiter({
    name: 'api',
    windowMs: 60_000,
    limit: 300,
    enabled,
    createStore,
    keyGenerator: (req) => `user:${req.user.id}`,
  })
}

// Chặn dò mã mời nhóm: tối đa 20 lần thử / 15 phút / IP.
export function createJoinLimiter(enabled, createStore) {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    ...(createStore ? { store: createStore('rl:join:') } : {}),
    skip: () => !enabled,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({
        error: { code: 'rate_limited', message: 'Bạn thử mã mời quá nhiều lần — vui lòng đợi một lúc rồi thử lại.' },
      }),
  })
}
