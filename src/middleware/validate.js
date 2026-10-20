import { badRequest } from '../lib/httpError.js'

// Kiểm tra req.body theo 1 schema zod. Hợp lệ → req.body được thay bằng dữ liệu ĐÃ làm sạch
// (trim, chữ thường email, bỏ field thừa). Không hợp lệ → 400 kèm danh sách lỗi từng field.
export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {})
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      return next(badRequest('validation_error', details[0]?.message || 'Dữ liệu không hợp lệ.', details))
    }
    req.body = result.data
    next()
  }
}

// Như validateBody nhưng cho query string (?since=...). Express 5 không cho ghi đè req.query,
// nên dữ liệu đã làm sạch được đặt vào req.validQuery.
export function validateQuery(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query ?? {})
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      return next(badRequest('validation_error', details[0]?.message || 'Dữ liệu không hợp lệ.', details))
    }
    req.validQuery = result.data
    next()
  }
}
