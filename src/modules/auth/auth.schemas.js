import { z } from 'zod'

// Mật khẩu MỚI (đăng ký, đặt lại, đổi) cần tối thiểu 8 ký tự — khớp với lib/limits.js ở FE.
// Giới hạn 72 BYTE (không phải ký tự) vì bcrypt chỉ đọc 72 byte đầu — chữ tiếng Việt có dấu
// chiếm 2-3 byte/ký tự trong UTF-8, nên phải đếm byte.
const newPassword = z
  .string({ error: 'Vui lòng nhập mật khẩu.' })
  .min(8, 'Mật khẩu cần tối thiểu 8 ký tự.')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Mật khẩu quá dài (tối đa 72 byte).')

const email = z
  .string({ error: 'Vui lòng nhập email.' })
  .trim()
  .toLowerCase()
  .max(254, 'Địa chỉ email không hợp lệ.')
  .pipe(z.email('Địa chỉ email không hợp lệ.'))

// Tên hiển thị: tự đặt, không bắt buộc. Cắt khoảng trắng 2 đầu và gộp khoảng trắng liên tiếp;
// chuỗi rỗng (xoá tên) → null. Chặn ký tự điều khiển (xuống dòng, tab...) để tên luôn nằm gọn 1 dòng.
export const DISPLAY_NAME_MAX = 40
const displayName = z
  .string({ error: 'Tên hiển thị không hợp lệ.' })
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .refine((v) => !/[\p{Cc}\p{Cf}]/u.test(v), 'Tên hiển thị chứa ký tự không hợp lệ.')
  .refine((v) => [...v].length <= DISPLAY_NAME_MAX, `Tên hiển thị tối đa ${DISPLAY_NAME_MAX} ký tự.`)
  .transform((v) => v || null)
  .nullable()

// Đăng nhập KHÔNG áp quy tắc độ dài: tài khoản cũ (tạo khi quy tắc còn là 6 ký tự, hoặc
// chuyển từ Supabase) vẫn đăng nhập được, chỉ cần khớp hash.
const anyPassword = z.string({ error: 'Vui lòng nhập mật khẩu.' }).min(1, 'Vui lòng nhập mật khẩu.')

export const registerSchema = z.object({ email, password: newPassword, display_name: displayName.optional() })
export const updateProfileSchema = z.object({ display_name: displayName })
export const loginSchema = z.object({ email, password: anyPassword })
export const forgotPasswordSchema = z.object({ email })
export const resetPasswordSchema = z.object({
  token: z.string({ error: 'Thiếu mã đặt lại mật khẩu.' }).min(1, 'Thiếu mã đặt lại mật khẩu.'),
  password: newPassword,
})
export const resendVerificationSchema = z.object({ email })
export const verifyEmailSchema = z.object({
  token: z.string({ error: 'Thiếu mã xác nhận email.' }).min(1, 'Thiếu mã xác nhận email.').max(200),
})
export const deleteAccountSchema = z.object({ password: anyPassword })
export const changePasswordSchema = z.object({ current_password: anyPassword, password: newPassword })
