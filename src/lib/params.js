import { z } from 'zod'
import { notFound } from './httpError.js'

const uuid = z.uuid()

// Kiểm tra :id trên URL là uuid hợp lệ. Sai định dạng → 404 (như "không tồn tại"), thay vì để
// Postgres ném lỗi cú pháp uuid thành 500.
export function uuidParam(name = 'id') {
  return (req, _res, next) => (uuid.safeParse(req.params[name]).success ? next() : next(notFound()))
}
