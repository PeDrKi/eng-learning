import { z } from 'zod'

const name = z
  .string({ error: 'Vui lòng nhập tên chủ đề.' })
  .trim()
  .min(1, 'Tên chủ đề không được để trống.')
  .max(100, 'Tên chủ đề tối đa 100 ký tự.')

export const createChapterSchema = z.object({
  name,
  group_id: z.uuid('group_id không hợp lệ.').nullish(),
})

export const updateChapterSchema = z.object({ name })
