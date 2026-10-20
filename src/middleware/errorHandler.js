import { HttpError } from '../lib/httpError.js'

// Định dạng lỗi thống nhất cho MỌI endpoint:
//   { "error": { "code": "invalid_credentials", "message": "Sai email hoặc mật khẩu.", "details"?: [...] } }

export function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, 'not_found', 'Không tìm thấy endpoint này.'))
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let httpErr = err
  if (!(err instanceof HttpError)) {
    if (err.type === 'entity.parse.failed') {
      httpErr = new HttpError(400, 'invalid_json', 'Dữ liệu gửi lên không phải JSON hợp lệ.')
    } else if (err.type === 'entity.too.large') {
      httpErr = new HttpError(413, 'payload_too_large', 'Dữ liệu gửi lên quá lớn.')
    } else {
      // Lỗi ngoài dự kiến: ghi đủ chi tiết vào log server, nhưng KHÔNG lộ ra client.
      console.error(`[error] ${req.method} ${req.originalUrl}`, err)
      httpErr = new HttpError(500, 'internal_error', 'Máy chủ gặp lỗi, thử lại sau.')
    }
  }
  const body = { error: { code: httpErr.code, message: httpErr.message } }
  if (httpErr.details) body.error.details = httpErr.details
  res.status(httpErr.status).json(body)
}
