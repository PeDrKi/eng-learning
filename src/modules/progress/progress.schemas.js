import { z } from 'zod'

// Tiến trình học SRS 2 chiều + thống kê quiz. Giá trị do FE tính (lib/srs.js, lib/fsrs.js); BE chỉ chặn
// giá trị vô lý (âm, NaN, sai định dạng ngày) để dữ liệu hỏng không lọt vào DB.
const ease = z.number().min(1, 'ease_factor không hợp lệ.').max(10, 'ease_factor không hợp lệ.')
const interval = z.number().min(0, 'interval_days không hợp lệ.').max(36500, 'interval_days không hợp lệ.')
// Trạng thái trí nhớ FSRS (migration 012) — null: chưa có (thẻ mới hoặc thẻ từ thời SM-2).
const stability = z.number().min(0.001, 'stability không hợp lệ.').max(36500, 'stability không hợp lệ.').nullable()
const difficulty = z.number().min(1, 'difficulty không hợp lệ.').max(10, 'difficulty không hợp lệ.').nullable()
const count = z.number().int().min(0).max(1_000_000)
const when = z.iso.datetime({ offset: true, error: 'Thời gian phải theo định dạng ISO 8601.' })

export const PROGRESS_FIELDS = [
  'ease_factor',
  'stability',
  'difficulty',
  'interval_days',
  'repetitions',
  'due_at',
  'last_reviewed_at',
  'ease_factor_rev',
  'stability_rev',
  'difficulty_rev',
  'interval_days_rev',
  'repetitions_rev',
  'due_at_rev',
  'last_reviewed_at_rev',
  'quiz_correct',
  'quiz_wrong',
  // Số lần chấm "Quên" (migration 007) — chỉ tăng, dùng để nhận ra từ mãi không thuộc.
  'lapses',
]

export const updateProgressSchema = z
  .object({
    ease_factor: ease.optional(),
    stability: stability.optional(),
    difficulty: difficulty.optional(),
    interval_days: interval.optional(),
    repetitions: count.optional(),
    due_at: when.optional(),
    last_reviewed_at: when.nullable().optional(),
    ease_factor_rev: ease.optional(),
    stability_rev: stability.optional(),
    difficulty_rev: difficulty.optional(),
    interval_days_rev: interval.optional(),
    repetitions_rev: count.optional(),
    due_at_rev: when.optional(),
    last_reviewed_at_rev: when.nullable().optional(),
    quiz_correct: count.optional(),
    quiz_wrong: count.optional(),
    lapses: count.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Không có gì để cập nhật.')
