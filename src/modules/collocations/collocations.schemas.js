import { z } from 'zod'

// Collocation lưu trong bảng `phrases` (migration 022). API gọi dạng đầy đủ là `pattern` cho rõ
// nghĩa; service đổi sang cột `phrase` khi đọc/ghi.
export const COLLOCATION_KINDS = ['dependent_prep', 'verb_pattern']

const required = (max, label) =>
  z
    .string({ error: `Vui lòng nhập ${label}.` })
    .trim()
    .min(1, `Vui lòng nhập ${label}.`)
    .max(max, `${label[0].toUpperCase()}${label.slice(1)} tối đa ${max} ký tự.`)
const text = (max, label) => z.string().trim().max(max, `${label} tối đa ${max} ký tự.`)

// Dạng sai hay gặp: bỏ ô trống và bỏ trùng (không phân biệt hoa/thường), giữ thứ tự nhập.
const mistakes = z
  .array(z.string().trim().max(100, 'Mỗi lỗi hay gặp tối đa 100 ký tự.'))
  .max(10, 'Tối đa 10 lỗi hay gặp.')
  .transform((list) => {
    const seen = new Set()
    return list.filter((m) => {
      const key = m.toLowerCase()
      if (!m || seen.has(key)) return false
      seen.add(key)
      return true
    })
  })

const fields = {
  kind: z.enum(COLLOCATION_KINDS, { error: 'Loại phải là dependent_prep hoặc verb_pattern.' }),
  headword: required(100, 'từ gốc'),
  pattern: required(300, 'cấu trúc'),
  answer: required(100, 'phần cần nhớ'),
  pattern_group: text(100, 'Nhóm mẫu'),
  mistakes,
  meaning: required(1000, 'nghĩa'),
  usage_context: text(2000, 'Trường hợp sử dụng'),
  example: text(2000, 'Câu ví dụ'),
  deck_id: z.uuid('deck_id không hợp lệ.').nullable(),
}

const newCollocation = z.object({
  kind: fields.kind,
  headword: fields.headword,
  pattern: fields.pattern,
  answer: fields.answer,
  pattern_group: fields.pattern_group.default(''),
  mistakes: fields.mistakes.default([]),
  meaning: fields.meaning,
  usage_context: fields.usage_context.default(''),
  example: fields.example.default(''),
  deck_id: fields.deck_id.default(null),
})

export const createCollocationSchema = newCollocation

export const bulkCreateCollocationsSchema = z.object({
  collocations: z.array(newCollocation).min(1, 'Danh sách trống.').max(500, 'Tối đa 500 mục mỗi lần.'),
})

export const updateCollocationSchema = z
  .object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])))
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Không có gì để cập nhật.')

// Tên trường API → cột trong bảng phrases. Chỉ những trường này được ghi; tên cột không bao giờ
// lấy từ client.
export const COLUMN_OF_FIELD = {
  kind: 'kind',
  headword: 'headword',
  pattern: 'phrase',
  answer: 'answer',
  pattern_group: 'pattern_group',
  mistakes: 'mistakes',
  meaning: 'meaning',
  usage_context: 'usage_context',
  example: 'example',
  deck_id: 'deck_id',
}
