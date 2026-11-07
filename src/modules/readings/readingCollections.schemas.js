import { z } from 'zod'

const name = z
  .string({ error: 'Vui lòng nhập tên bộ.' })
  .trim()
  .min(1, 'Tên bộ không được để trống.')
  .max(100, 'Tên bộ tối đa 100 ký tự.')
const description = z.string().trim().max(500, 'Mô tả tối đa 500 ký tự.')
const deckId = z.uuid('deck_id không hợp lệ.')

// `deck_id` bỏ trống khi tạo → tự tạo chủ đề cá nhân cùng tên với bộ. Gửi id → gắn chủ đề có sẵn.
export const createCollectionSchema = z.object({
  name,
  description: description.default(''),
  deck_id: deckId.optional(),
})

// `deck_id: null` = bỏ liên kết chủ đề (từ lưu sau đó không gắn chủ đề nào).
export const updateCollectionSchema = z
  .object({ name: name.optional(), description: description.optional(), deck_id: deckId.nullable().optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Không có gì để cập nhật.')

export const deleteCollectionQuery = z.object({
  delete_readings: z.enum(['true', 'false']).default('false'),
})
