import { conflict } from './httpError.js'

// Hạn mức dữ liệu mỗi tài khoản — chặn 1 tài khoản (hoặc script lạm dụng) nhồi dữ liệu vô hạn làm
// đầy database dùng chung. Mức mặc định rộng hơn nhiều so với nhu cầu học thật; chỉnh bằng biến
// môi trường QUOTA_* (xem config.js).
//
// Đây là hạn mức "mềm": đếm rồi mới thêm, không khoá bảng — 2 request đồng thời có thể vượt nhẹ
// vài dòng. Chấp nhận được vì mục tiêu là chặn lạm dụng, không phải đếm chính xác tuyệt đối.
//
// `table`/`column` là hằng số trong code (không bao giờ lấy từ client).
export async function assertWithinQuota(db, { table, column = 'user_id', userId, adding = 1, max, what }) {
  const { rows } = await db.query(`select count(*)::int as n from ${table} where ${column} = $1`, [userId])
  if (rows[0].n + adding > max) {
    throw conflict(
      'quota_exceeded',
      `Đã đạt giới hạn ${max} ${what} cho mỗi tài khoản (hiện có ${rows[0].n}). Hãy xoá bớt trước khi thêm mới.`,
    )
  }
}
