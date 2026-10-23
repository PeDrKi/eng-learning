import { z } from 'zod'

// Giới hạn đủ rộng cho một bài báo dài / kịch bản hội thoại, nhưng chặn việc nhồi cả cuốn sách
// vào một dòng database.
export const MAX_CONTENT = 50_000
export const MAX_NOTES = 300

const note = z.object({
  // id do FE tạo (crypto.randomUUID) để sửa/xoá đúng ghi chú khi lưu tự động cả danh sách.
  id: z.string().trim().min(1).max(64),
  type: z.enum(['word', 'grammar', 'phrase'], { error: 'Loại ghi chú phải là word, grammar hoặc phrase.' }),
  text: z.string().trim().min(1, 'Ghi chú không được trống.').max(500, 'Nội dung ghi chú tối đa 500 ký tự.'),
  meaning: z.string().trim().max(1000, 'Nghĩa tối đa 1000 ký tự.').default(''),
  explanation: z.string().trim().max(2000, 'Giải thích tối đa 2000 ký tự.').default(''),
  example: z.string().trim().max(2000, 'Câu ví dụ tối đa 2000 ký tự.').default(''),
  // Đã thêm vào Sổ từ / Câu giao tiếp chưa — để FE hiện "Đã lưu" thay vì cho lưu trùng.
  saved_to: z
    .object({ kind: z.enum(['word', 'phrase']), id: z.uuid('saved_to.id không hợp lệ.') })
    .nullable()
    .default(null),
})

const fields = {
  title: z.string().trim().max(200, 'Tiêu đề tối đa 200 ký tự.'),
  content: z.string().max(MAX_CONTENT, `Văn bản tối đa ${MAX_CONTENT.toLocaleString('vi-VN')} ký tự.`),
  notes: z
    .array(note)
    .max(MAX_NOTES, `Mỗi bài tối đa ${MAX_NOTES} ghi chú.`)
    .refine((list) => new Set(list.map((n) => n.id)).size === list.length, 'Trùng id ghi chú.'),
}

export const createReadingSchema = z.object({
  title: fields.title.default(''),
  content: fields.content.default(''),
  notes: fields.notes.default([]),
})

export const updateReadingSchema = z
  .object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])))
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Không có gì để cập nhật.')
