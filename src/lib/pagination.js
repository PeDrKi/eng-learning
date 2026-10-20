import { z } from 'zod'
import { badRequest } from './httpError.js'

// Phân trang kiểu "con trỏ" (keyset) cho các danh sách có thể rất dài (từ vựng, tiến trình học).
//
//   GET /words                      → mảng đầy đủ như trước (tương thích ngược).
//   GET /words?limit=500            → { items: [...], next_cursor: "..." | null }
//   GET /words?limit=500&cursor=... → trang kế tiếp; hết dữ liệu khi next_cursor = null.
//
// Dùng con trỏ thay vì offset: trang sau luôn bắt đầu NGAY SAU dòng cuối của trang trước, nên
// không bị lặp/sót dòng khi dữ liệu đổi giữa 2 lần gọi, và DB không phải đếm lại từ đầu.

export const MAX_PAGE_SIZE = 1000

export const pageQuery = z.object({
  limit: z.coerce
    .number({ error: 'limit phải là số.' })
    .int('limit phải là số nguyên.')
    .min(1, `limit từ 1 đến ${MAX_PAGE_SIZE}.`)
    .max(MAX_PAGE_SIZE, `limit từ 1 đến ${MAX_PAGE_SIZE}.`)
    .optional(),
  cursor: z.string().max(500).optional(),
})

// Con trỏ là chuỗi mờ (base64url của JSON) — client chỉ việc gửi lại nguyên văn.
export const encodeCursor = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

export function decodeCursor(cursor, schema) {
  if (cursor === undefined) return null
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
  } catch {
    throw badRequest('invalid_cursor', 'cursor không hợp lệ.')
  }
}

// `rows` được truy vấn với LIMIT limit + 1: dòng thừa (nếu có) chỉ để biết còn trang sau.
export function toPage(rows, limit, cursorOf) {
  const items = rows.slice(0, limit)
  const hasMore = rows.length > limit
  return { items, next_cursor: hasMore ? encodeCursor(cursorOf(items[items.length - 1])) : null }
}
