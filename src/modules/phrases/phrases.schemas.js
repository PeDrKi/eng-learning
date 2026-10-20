import { z } from 'zod'

const fields = {
  phrase: z
    .string({ error: 'Vui lòng nhập câu tiếng Anh.' })
    .trim()
    .min(1, 'Vui lòng nhập câu tiếng Anh.')
    .max(500, 'Câu tối đa 500 ký tự.'),
  meaning: z
    .string({ error: 'Vui lòng nhập nghĩa.' })
    .trim()
    .min(1, 'Vui lòng nhập nghĩa.')
    .max(1000, 'Nghĩa tối đa 1000 ký tự.'),
  usage_context: z.string().trim().max(2000, 'Trường hợp sử dụng tối đa 2000 ký tự.'),
  example: z.string().trim().max(2000, 'Câu ví dụ tối đa 2000 ký tự.'),
  formality: z.enum(['formal', 'informal', 'neutral'], { error: 'Mức độ phải là formal, informal hoặc neutral.' }),
  deck_id: z.uuid('deck_id không hợp lệ.').nullable(),
}

export const createPhraseSchema = z.object({
  phrase: fields.phrase,
  meaning: fields.meaning,
  usage_context: fields.usage_context.default(''),
  example: fields.example.default(''),
  formality: fields.formality.default('neutral'),
  deck_id: fields.deck_id.default(null),
})

export const updatePhraseSchema = z
  .object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])))
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Không có gì để cập nhật.')

export const PHRASE_FIELDS = Object.keys(fields)

// Tiến trình học của CÂU (migration 006): một chiều duy nhất — nhìn nghĩa tiếng Việt, nhớ lại câu
// tiếng Anh. Giá trị do FE tính bằng lib/srs.js (FSRS); BE chỉ chặn giá trị vô lý.
const ease = z.number().min(1, 'ease_factor không hợp lệ.').max(10, 'ease_factor không hợp lệ.')
const interval = z.number().min(0, 'interval_days không hợp lệ.').max(36500, 'interval_days không hợp lệ.')
const when = z.iso.datetime({ offset: true, error: 'Thời gian phải theo định dạng ISO 8601.' })

export const updatePhraseProgressSchema = z
  .object({
    ease_factor: ease.optional(),
    // Trạng thái trí nhớ FSRS (migration 012) — xem progress.schemas.js.
    stability: z
      .number()
      .min(0.001, 'stability không hợp lệ.')
      .max(36500, 'stability không hợp lệ.')
      .nullable()
      .optional(),
    difficulty: z.number().min(1, 'difficulty không hợp lệ.').max(10, 'difficulty không hợp lệ.').nullable().optional(),
    interval_days: interval.optional(),
    repetitions: z.number().int().min(0).max(1_000_000).optional(),
    due_at: when.optional(),
    last_reviewed_at: when.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Không có gì để cập nhật.')
