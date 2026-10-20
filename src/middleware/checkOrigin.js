import { forbidden } from '../lib/httpError.js'

// Chống CSRF cho các endpoint xác thực bằng COOKIE (refresh, logout): trình duyệt tự đính kèm
// cookie kể cả khi request xuất phát từ trang web lạ, nên phải tự kiểm tra Origin. Trình duyệt
// hiện đại luôn gửi header Origin với request POST; không có Origin = không phải trình duyệt
// (curl, Postman...) → không có rủi ro CSRF, cho qua.
export function checkOrigin(allowedOrigins) {
  return (req, _res, next) => {
    const origin = req.get('origin')
    if (origin && !allowedOrigins.includes(origin)) {
      return next(forbidden('Yêu cầu đến từ nguồn không được phép.'))
    }
    next()
  }
}
