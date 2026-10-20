import { Router } from 'express'
import { z } from 'zod'
import { unauthorized } from '../../lib/httpError.js'
import { validateBody } from '../../middleware/validate.js'

// Cài đặt học của từng người — đồng bộ qua mọi thiết bị. Chưa từng lưu → trả giá trị mặc
// định (không cần FE tự xử lý trường hợp "chưa có dòng"). Giá trị mặc định ở đây PHẢI khớp
// default của bảng user_settings (migrations 001 + 003 + 010).
const DEFAULTS = {
  new_cards_per_day: 5,
  session_size: 10,
  daily_goal: 20,
  reviews_per_day: 100,
  // Nhắc học hằng ngày (migration 008). `reminder_tz` là múi giờ IANA của người học — giờ nhắc
  // phải tính theo giờ CỦA HỌ, không theo giờ máy chủ.
  reminder_enabled: false,
  reminder_hour: 20,
  reminder_tz: 'Asia/Ho_Chi_Minh',
}
const FIELDS = Object.keys(DEFAULTS)
// Giá trị mặc định viết thẳng vào câu SQL (không phải tham số) nên phải tự bọc nháy cho chuỗi.
const sqlDefault = (v) => (typeof v === 'string' ? `'${v}'` : String(v))

// Múi giờ IANA có thật hay không — hỏi thẳng Intl của Node, khỏi cần bảng tra riêng.
function isValidTimeZone(value) {
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone: value }))
  } catch {
    return false
  }
}

const intBetween = (min, max, label) =>
  z
    .number({ error: `Vui lòng nhập ${label}.` })
    .int(`${label[0].toUpperCase()}${label.slice(1)} phải là số nguyên.`)
    .min(min, `${label[0].toUpperCase()}${label.slice(1)} từ ${min} đến ${max}.`)
    .max(max, `${label[0].toUpperCase()}${label.slice(1)} từ ${min} đến ${max}.`)

// Gửi field nào đổi field đó; field không gửi giữ nguyên giá trị cũ (khớp các ô ở SettingsModal).
const updateSettingsSchema = z
  .object({
    new_cards_per_day: intBetween(0, 200, 'số từ mới mỗi ngày').optional(), // 0 = tạm dừng học từ mới
    session_size: intBetween(3, 50, 'số thẻ mỗi phiên').optional(),
    daily_goal: intBetween(1, 500, 'mục tiêu mỗi ngày').optional(),
    reviews_per_day: intBetween(10, 1000, 'số thẻ ôn mỗi ngày').optional(),
    reminder_enabled: z.boolean().optional(),
    reminder_hour: intBetween(0, 23, 'giờ nhắc học').optional(),
    reminder_tz: z.string().max(64, 'Múi giờ quá dài.').refine(isValidTimeZone, 'Múi giờ không hợp lệ.').optional(),
  })
  .refine((v) => FIELDS.some((k) => v[k] !== undefined), 'Không có gì để cập nhật.')

const COLUMNS = FIELDS.join(', ')

export function createSettingsRouter({ pool }) {
  const router = Router()

  router.get('/', async (req, res) => {
    const { rows } = await pool.query(`select ${COLUMNS} from user_settings where user_id = $1`, [req.user.id])
    res.json(rows[0] ?? DEFAULTS)
  })

  router.put('/', validateBody(updateSettingsSchema), async (req, res) => {
    const values = FIELDS.map((k) => req.body[k] ?? null)
    try {
      // Chưa có dòng → tạo với giá trị gửi lên (thiếu thì lấy mặc định); có rồi → chỉ đổi field gửi lên.
      const { rows } = await pool.query(
        `insert into user_settings (user_id, ${COLUMNS}, updated_at)
         values ($1, ${FIELDS.map((k, i) => `coalesce($${i + 2}, ${sqlDefault(DEFAULTS[k])})`).join(', ')}, now())
         on conflict (user_id) do update set
           ${FIELDS.map((k, i) => `${k} = coalesce($${i + 2}, user_settings.${k})`).join(', ')},
           updated_at = now()
         returning ${COLUMNS}`,
        [req.user.id, ...values],
      )
      res.json(rows[0])
    } catch (err) {
      // Tài khoản đã bị xoá nhưng access token cũ vẫn còn hạn.
      if (err.code === '23503') throw unauthorized('invalid_token', 'Tài khoản không còn tồn tại.')
      throw err
    }
  })

  return router
}
