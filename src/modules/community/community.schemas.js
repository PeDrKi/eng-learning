import { z } from 'zod'
import { wordFields } from '../words/words.schemas.js'

export const listPublicDecksQuery = z.object({
  q: z.string().trim().max(100, 'Từ khoá tối đa 100 ký tự.').optional(),
})

export const publishDeckSchema = z.object({
  description: z.string().trim().max(500, 'Mô tả tối đa 500 ký tự.').default(''),
})

// revoke_followers: true = người đã lưu cũng mất quyền xem/học (xoá họ khỏi danh sách đã lưu).
// Mặc định false: người đã lưu học tiếp được, chỉ không ai lưu thêm.
export const unpublishDeckSchema = z.object({
  revoke_followers: z.boolean().default(false),
})

export const listCommentsQuery = z.object({
  word_id: z.uuid('word_id không hợp lệ.').optional(),
})

export const addCommentSchema = z.object({
  body: z
    .string({ error: 'Vui lòng nhập nội dung nhận xét.' })
    .trim()
    .min(1, 'Vui lòng nhập nội dung nhận xét.')
    .max(1000, 'Nhận xét tối đa 1000 ký tự.'),
  word_id: z.uuid('word_id không hợp lệ.').nullish(),
})

// ---- Đề xuất chỉnh sửa (giai đoạn 3) ----
// Các trường người khác được đề xuất — nội dung học của từ. Không gồm link phát âm (tránh đưa link
// lạ vào chủ đề của người khác), nhãn và từ loại (cách sắp xếp riêng của chủ sở hữu).
export const SUGGESTION_FIELDS = ['word', 'meaning', 'meaning_en', 'example', 'ipa']

const proposedEdit = z
  .object({
    word: wordFields.word.optional(),
    meaning: wordFields.meaning.optional(),
    meaning_en: wordFields.meaning_en.optional(),
    example: wordFields.example.optional(),
    ipa: wordFields.ipa.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Hãy đề xuất ít nhất một thay đổi.')

const proposedAdd = z.object({
  word: wordFields.word,
  meaning: wordFields.meaning,
  meaning_en: wordFields.meaning_en.default(''),
  example: wordFields.example.default(''),
  ipa: wordFields.ipa.default(''),
})

const reason = z.string().trim().max(1000, 'Lý do tối đa 1000 ký tự.')

export const createSuggestionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('edit'),
    word_id: z.uuid('word_id không hợp lệ.'),
    proposed: proposedEdit,
    reason: reason.default(''),
  }),
  z.object({ kind: z.literal('add'), proposed: proposedAdd, reason: reason.default('') }),
  z.object({
    kind: z.literal('delete'),
    word_id: z.uuid('word_id không hợp lệ.'),
    reason: reason.min(1, 'Hãy ghi lý do muốn xoá từ này.'),
  }),
])

export const listSuggestionsQuery = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'stale', 'all']).default('pending'),
})

// force: chấp nhận dù từ đã bị sửa sau khi người ta đề xuất (người duyệt đã xem cảnh báo xung đột).
export const acceptSuggestionSchema = z.object({
  note: z.string().trim().max(1000, 'Ghi chú tối đa 1000 ký tự.').default(''),
  force: z.boolean().default(false),
})

export const rejectSuggestionSchema = z.object({
  note: z.string().trim().max(1000, 'Ghi chú tối đa 1000 ký tự.').default(''),
})

export const reportSchema = z.object({
  target_type: z.enum(['deck', 'comment', 'suggestion'], { error: 'Loại nội dung không hợp lệ.' }),
  target_id: z.uuid('target_id không hợp lệ.'),
  reason: z.string().trim().max(1000, 'Lý do tối đa 1000 ký tự.').default(''),
})

export const listReportsQuery = z.object({
  status: z.enum(['open', 'resolved', 'dismissed', 'all']).default('open'),
})

export const closeReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed'], { error: 'Trạng thái phải là resolved hoặc dismissed.' }),
})
