import jwt from 'jsonwebtoken'
import { unauthorized } from '../lib/httpError.js'
import { verifyAccessToken } from '../lib/tokens.js'

// Bắt buộc có access token hợp lệ trong header `Authorization: Bearer <token>`.
// Thành công → gắn req.user = { id, email }. Mọi route cần đăng nhập đều đi qua đây.
//
// Token hết hạn trả code riêng `token_expired` (khác `unauthorized`) để FE biết cần gọi
// POST /auth/refresh rồi thử lại, thay vì đá người dùng ra màn đăng nhập.
export function requireAuth(config) {
  return (req, _res, next) => {
    const header = req.get('authorization') || ''
    const [scheme, token] = header.split(' ')
    if (scheme !== 'Bearer' || !token) return next(unauthorized())
    try {
      const payload = verifyAccessToken(token, { secret: config.auth.accessSecret })
      req.user = { id: payload.sub, email: payload.email }
      next()
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return next(unauthorized('token_expired', 'Phiên đăng nhập đã hết hạn.'))
      }
      next(unauthorized('invalid_token', 'Phiên đăng nhập không hợp lệ.'))
    }
  }
}
