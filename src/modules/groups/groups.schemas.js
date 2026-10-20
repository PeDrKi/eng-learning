import { z } from 'zod'

const name = z
  .string({ error: 'Vui lòng nhập tên nhóm.' })
  .trim()
  .min(1, 'Tên nhóm không được để trống.')
  .max(100, 'Tên nhóm tối đa 100 ký tự.')

export const createGroupSchema = z.object({ name })
export const renameGroupSchema = z.object({ name })
export const memberRoleSchema = z.object({
  role: z.enum(['admin', 'member'], { error: 'Vai trò phải là admin hoặc member.' }),
})

// Mã mời không phân biệt hoa/thường, bỏ khoảng trắng thừa (hay dính khi copy/paste).
export const joinGroupSchema = z.object({
  code: z
    .string({ error: 'Vui lòng nhập mã mời.' })
    .trim()
    .toLowerCase()
    .min(1, 'Vui lòng nhập mã mời.')
    .max(32, 'Mã mời không đúng — kiểm tra lại với trưởng nhóm.'),
})
