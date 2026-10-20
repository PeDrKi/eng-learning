import { z } from 'zod'
import { pageQuery } from '../../lib/pagination.js'

export const listUsersQuery = pageQuery.extend({
  q: z.string().trim().max(254).optional(), // tìm theo email (chứa chuỗi, không phân biệt hoa/thường)
})

// Vai trò super_admin CỐ Ý không có ở đây: không cấp được qua API, chỉ gán bằng SQL thủ công.
export const updateUserSchema = z
  .object({
    role: z.enum(['user', 'admin'], { error: 'Vai trò phải là user hoặc admin.' }).optional(),
    disabled: z.boolean({ error: 'disabled phải là true hoặc false.' }).optional(),
  })
  .refine((v) => v.role !== undefined || v.disabled !== undefined, 'Không có gì để cập nhật.')

// Số ngày của biểu đồ theo ngày trên trang tổng quan (tính cả hôm nay).
export const overviewQuery = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
})
