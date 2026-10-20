import { z } from 'zod'

// Múi giờ IANA có thật hay không — hỏi thẳng Intl của Node, không cần bảng tra riêng.
function isValidTimeZone(value) {
  try {
    // Dùng kết quả (dù chỉ để vứt đi) — gọi `new` chỉ để lấy lỗi bị oxlint cảnh báo.
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone: value }))
  } catch {
    return false
  }
}

// Một dòng nhật ký gắn với ĐÚNG MỘT đối tượng: từ vựng hoặc câu giao tiếp (migration 006).
export const createReviewLogSchema = z
  .object({
    word_id: z.uuid('word_id không hợp lệ.').optional(),
    phrase_id: z.uuid('phrase_id không hợp lệ.').optional(),
    // Điểm chấm ở tab Học: 0 = Quên, 1 = Khó, 2 = Tốt, 3 = Dễ (xem lib/srs.js ở FE).
    quality: z.number({ error: 'Thiếu điểm chấm.' }).int().min(0).max(3, 'Điểm chấm chỉ từ 0 đến 3.'),
    direction: z.enum(['recognition', 'production']).default('recognition'),
    // Lượt ôn đến từ đâu (migration 009). Quiz/Chính tả: đúng = 2, sai = 0.
    source: z.enum(['study', 'quiz', 'spelling']).default('study'),
    // Chỉ FE gửi khi ĐỒNG BỘ kết quả ôn lúc mất mạng (thời điểm ôn thật). Xem reviewLog.service.js
    // về khoảng thời gian được chấp nhận.
    reviewed_at: z.iso.datetime({ offset: true, error: 'reviewed_at phải theo định dạng ISO 8601.' }).optional(),
  })
  .refine((v) => !!v.word_id !== !!v.phrase_id, 'Cần đúng một trong word_id hoặc phrase_id.')

export const listReviewLogQuery = z.object({
  // Mặc định 90 ngày gần nhất (đúng khoảng FE dùng cho Thống kê).
  since: z.iso.datetime({ offset: true, error: 'since phải theo định dạng ISO 8601.' }).optional(),
})

export const dailyReviewLogQuery = z.object({
  since: z.iso.datetime({ offset: true, error: 'since phải theo định dạng ISO 8601.' }).optional(),
  // Múi giờ IANA của máy người học (VD 'Asia/Ho_Chi_Minh') — quyết định mốc cắt ngày. Thiếu thì
  // dùng UTC. Giá trị được truyền vào PostgreSQL dưới dạng THAM SỐ, không ghép chuỗi.
  tz: z
    .string()
    .max(64, 'tz quá dài.')
    // Kiểm ngay ở đây thay vì chờ PostgreSQL báo lỗi: nếu người học chưa có lượt ôn nào thì câu
    // truy vấn gộp không đụng tới múi giờ, sai cũng không ai phát hiện.
    .refine(isValidTimeZone, 'Múi giờ không hợp lệ.')
    .optional(),
})
