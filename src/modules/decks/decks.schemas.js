import { z } from 'zod'

const name = z
  .string({ error: 'Vui lòng nhập tên chủ đề con.' })
  .trim()
  .min(1, 'Tên chủ đề con không được để trống.')
  .max(100, 'Tên chủ đề con tối đa 100 ký tự.')
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Màu phải có dạng #RRGGBB.')

// Các field thừa FE đang gửi kèm (VD: user_id) bị bỏ qua: chủ sở hữu luôn là người đang
// đăng nhập, client không tự khai được.
export const createDeckSchema = z.object({
  name,
  color: color.optional(),
  group_id: z.uuid('group_id không hợp lệ.').nullish(),
  chapter_id: z.uuid('chapter_id không hợp lệ.').nullish(),
})

// Tạo nhiều chủ đề CÁ NHÂN một lúc (dùng khi nhập file CSV/JSON).
export const bulkCreateDecksSchema = z.object({
  decks: z
    .array(z.object({ name, color: color.optional() }))
    .min(1, 'Danh sách chủ đề con trống.')
    .max(200, 'Tối đa 200 chủ đề con mỗi lần.'),
})

// chapter_id: uuid = xếp vào chương đó, null = bỏ khỏi chương, không gửi = giữ nguyên.
export const updateDeckSchema = z
  .object({
    name: name.optional(),
    color: color.optional(),
    chapter_id: z.uuid('chapter_id không hợp lệ.').nullable().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.color !== undefined || v.chapter_id !== undefined,
    'Không có gì để cập nhật.',
  )
