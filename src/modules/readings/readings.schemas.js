import { z } from 'zod'

// Giới hạn đủ rộng cho một bài báo dài / kịch bản hội thoại, nhưng chặn việc nhồi cả cuốn sách
// vào một dòng database.
export const MAX_CONTENT = 50_000
export const MAX_NOTES = 300
// Bài ngắn: 1 hoặc vài câu. Bản dịch: mỗi đoạn một chuỗi.
export const MAX_SHORT_CONTENT = 1000
export const MAX_TRANSLATIONS = 500
export const MAX_TRANSLATION = 10_000
export const READING_KINDS = ['short', 'long']
export const SHORT_TOO_LONG = `Câu / đoạn ngắn tối đa ${MAX_SHORT_CONTENT.toLocaleString('vi-VN')} ký tự — dài hơn thì dùng "Bài đọc dài".`

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
  translations: z
    .array(
      z.string().max(MAX_TRANSLATION, `Bản dịch mỗi đoạn tối đa ${MAX_TRANSLATION.toLocaleString('vi-VN')} ký tự.`),
    )
    .max(MAX_TRANSLATIONS, `Tối đa ${MAX_TRANSLATIONS} đoạn bản dịch.`),
  // Bộ bài đọc (migration 031): null = "Ghi chú" (bài lẻ). `position` = thứ tự trang trong bộ; bỏ trống
  // khi thêm / chuyển bài vào bộ thì tự xếp cuối bộ.
  collection_id: z.uuid('collection_id không hợp lệ.').nullable(),
  position: z.number().int().min(0, 'position không hợp lệ.').max(1_000_000, 'position không hợp lệ.'),
}

// Loại bài chỉ chọn lúc tạo (tab "Câu / đoạn ngắn" hay "Bài đọc dài"), không đổi về sau.
export const createReadingSchema = z
  .object({
    kind: z.enum(READING_KINDS, { error: 'Loại bài phải là short hoặc long.' }).default('long'),
    title: fields.title.default(''),
    content: fields.content.default(''),
    notes: fields.notes.default([]),
    translations: fields.translations.default([]),
    collection_id: fields.collection_id.default(null),
    position: fields.position.optional(),
  })
  .refine((v) => v.kind !== 'short' || v.content.length <= MAX_SHORT_CONTENT, {
    message: SHORT_TOO_LONG,
    path: ['content'],
  })

export const updateReadingSchema = z
  .object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])))
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Không có gì để cập nhật.')
