import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'

const ISSUER = 'tuvung-api'
const AUDIENCE = 'tuvung-app'

// Access token: JWT ngắn hạn (mặc định 15 phút), gửi qua header Authorization. Không lưu DB,
// kiểm tra bằng chữ ký — nhanh, không tốn truy vấn cho mỗi request.
export function signAccessToken(user, { secret, ttlSeconds }) {
  return jwt.sign({ email: user.email }, secret, {
    subject: user.id,
    expiresIn: ttlSeconds,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
  })
}

// Ném lỗi của thư viện jsonwebtoken (TokenExpiredError / JsonWebTokenError) nếu không hợp lệ.
export function verifyAccessToken(token, { secret }) {
  return jwt.verify(token, secret, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] })
}

// Token ngẫu nhiên (refresh token, token đặt lại mật khẩu): 32 byte = 256 bit entropy.
export function generateOpaqueToken() {
  return randomBytes(32).toString('base64url')
}

// DB chỉ lưu sha256 của token. Không cần bcrypt ở đây: token đã ngẫu nhiên 256 bit, không
// dò được bằng từ điển như mật khẩu người dùng tự đặt.
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}
