import { z } from 'zod'

export const listPublicReadingsQuery = z.object({
  q: z.string().trim().max(100, 'Từ khoá tối đa 100 ký tự.').optional(),
  saved: z.enum(['true', 'false']).default('false'),
})

export const publishCollectionSchema = z.object({
  description: z.string().trim().max(500, 'Mô tả tối đa 500 ký tự.').optional(),
  include_translations: z.boolean().default(true),
  // Nguyên văn mặc định ẨN: người xem chỉ thấy ghi chú + bản dịch.
  include_content: z.boolean().default(false),
  // Chia sẻ luôn chủ đề từ vựng gắn với bộ.
  publish_deck: z.boolean().default(true),
})

export const publishReadingSchema = z.object({
  include_translations: z.boolean().default(true),
  include_content: z.boolean().default(false),
})

export const addReadingCommentSchema = z.object({
  body: z.string().trim().min(1, 'Nhận xét không được để trống.').max(1000, 'Nhận xét tối đa 1000 ký tự.'),
  // Chỉ dùng ở luồng của BỘ: nhận xét cho 1 trang trong bộ.
  reading_id: z.uuid('reading_id không hợp lệ.').nullable().optional(),
})

export const listReadingCommentsQuery = z.object({
  reading_id: z.uuid('reading_id không hợp lệ.').optional(),
})

// ---------------- Đề xuất sửa bài đọc (migration 034) ----------------
const noteText = z.string().trim().min(1, 'Ghi chú không được trống.').max(500, 'Nội dung ghi chú tối đa 500 ký tự.')
const noteFields = {
  type: z.enum(['word', 'grammar', 'phrase'], { error: 'Loại ghi chú phải là word, grammar hoặc phrase.' }),
  text: noteText,
  meaning: z.string().trim().max(1000, 'Nghĩa tối đa 1000 ký tự.'),
  explanation: z.string().trim().max(2000, 'Giải thích tối đa 2000 ký tự.'),
  example: z.string().trim().max(2000, 'Câu ví dụ tối đa 2000 ký tự.'),
}
const reason = z.string().trim().max(1000, 'Lý do tối đa 1000 ký tự.').default('')
const paragraph = z.number().int().min(0, 'Đoạn không hợp lệ.').max(10_000, 'Đoạn không hợp lệ.')
const collectionContext = z.uuid('collection_id không hợp lệ.').nullable().optional()

export const createReadingSuggestionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('add_note'),
    proposed: z.object({
      type: noteFields.type,
      text: noteFields.text,
      meaning: noteFields.meaning.default(''),
      explanation: noteFields.explanation.default(''),
      example: noteFields.example.default(''),
    }),
    reason,
    collection_id: collectionContext,
  }),
  z.object({
    kind: z.literal('edit_note'),
    note_id: z.string().trim().min(1).max(64),
    proposed: z
      .object({
        type: noteFields.type.optional(),
        text: noteFields.text.optional(),
        meaning: noteFields.meaning.optional(),
        explanation: noteFields.explanation.optional(),
        example: noteFields.example.optional(),
      })
      .refine((p) => Object.values(p).some((v) => v !== undefined), 'Chưa có thay đổi nào.'),
    reason,
    collection_id: collectionContext,
  }),
  z.object({
    kind: z.literal('translation'),
    paragraph,
    proposed: z.object({
      text: z.string().trim().min(1, 'Bản dịch không được trống.').max(10_000, 'Bản dịch tối đa 10.000 ký tự.'),
    }),
    reason,
    collection_id: collectionContext,
  }),
  z.object({
    kind: z.literal('typo'),
    paragraph,
    proposed: z
      .object({
        find: z.string().min(1, 'Hãy nhập đoạn chữ cần sửa.').max(500, 'Tối đa 500 ký tự.'),
        replace: z.string().max(500, 'Tối đa 500 ký tự.'),
      })
      .refine((p) => p.find !== p.replace, 'Chữ sửa giống hệt chữ cũ.'),
    reason,
    collection_id: collectionContext,
  }),
])

export const listReadingSuggestionsQuery = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'stale', 'all']).default('pending'),
})

export const reviewReadingSuggestionSchema = z.object({
  note: z.string().trim().max(1000, 'Ghi chú tối đa 1000 ký tự.').default(''),
  force: z.boolean().default(false),
})
