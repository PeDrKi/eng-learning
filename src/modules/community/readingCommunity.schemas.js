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
