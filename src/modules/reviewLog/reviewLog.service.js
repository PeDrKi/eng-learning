import { badRequest, notFound } from '../../lib/httpError.js'
import { findVisibleWord } from '../words/words.service.js'

const DEFAULT_WINDOW_DAYS = 90
// Kết quả ôn lúc mất mạng được đồng bộ muộn tối đa bấy nhiêu ngày mà vẫn giữ đúng ngày ôn.
const OFFLINE_SYNC_WINDOW_DAYS = 7

// Nhật ký ôn tập: mỗi lần chấm 1 thẻ ở tab Học (hoặc trả lời 1 câu Quiz/Chính tả — cột source) ghi 1 dòng — nguồn dữ liệu cho chuỗi ngày học
// và biểu đồ hoạt động ở tab Thống kê. Chỉ ghi thêm, không sửa/xoá qua API.
export function createReviewLogService({ pool }) {
  async function listMine({ userId }, since) {
    const from = since ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString()
    const { rows } = await pool.query(
      `select id, word_id, phrase_id, quality, direction, source, reviewed_at from review_log
       where user_id = $1 and reviewed_at >= $2
       order by reviewed_at desc`,
      [userId, from],
    )
    return rows
  }

  // Số lượt ôn theo TỪNG NGÀY trong khoảng — thay cho việc trả về từng dòng một.
  //
  // Thống kê chỉ cần 2 thứ từ quá khứ: ngày nào có học (chuỗi ngày) và mỗi ngày bao nhiêu lượt
  // (biểu đồ hoạt động). Trả nguyên 90 ngày dòng thô cho một người học chăm là ~2300 dòng / 116KB
  // mỗi lần mở app, trong khi gộp lại chỉ còn tối đa 90 dòng. Những dòng thô của RIÊNG HÔM NAY
  // vẫn lấy qua listMine (cần word_id để biết từ nào đã được giới thiệu trong ngày).
  //
  // `timeZone`: ngày phải cắt theo giờ ĐỊA PHƯƠNG của người học, không phải UTC — 8 giờ tối ở
  // Việt Nam đã là ngày hôm sau theo UTC, gộp nhầm sẽ làm lệch cả chuỗi ngày lẫn biểu đồ.
  async function dailyCounts({ userId }, { since, timeZone } = {}) {
    const from = since ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString()
    try {
      const { rows } = await pool.query(
        `select to_char(date_trunc('day', reviewed_at at time zone $3), 'YYYY-MM-DD') as day,
                count(*)::int as count
           from review_log
          where user_id = $1 and reviewed_at >= $2
          group by 1
          order by 1`,
        [userId, from, timeZone || 'UTC'],
      )
      return rows
    } catch (err) {
      // 22023: múi giờ không tồn tại (FE gửi chuỗi lạ) — coi như yêu cầu sai, không phải lỗi server.
      if (err.code === '22023') throw badRequest('invalid_time_zone', 'Múi giờ không hợp lệ.')
      throw err
    }
  }

  // Thời điểm ôn mặc định lấy theo giờ SERVER. Ngoại lệ duy nhất: FE gửi `reviewed_at` khi đồng
  // bộ kết quả ôn lúc mất mạng — chỉ được chấp nhận nếu nằm trong OFFLINE_SYNC_WINDOW_DAYS ngày
  // gần nhất và không ở tương lai; ngoài khoảng đó thì dùng giờ server. Nhờ vậy học offline vẫn
  // giữ được chuỗi ngày học, nhưng không "lùi ngày" tuỳ ý để vá chuỗi đã đứt từ lâu.
  function resolveReviewedAt(clientValue) {
    if (!clientValue) return new Date()
    const at = new Date(clientValue)
    const now = Date.now()
    const oldest = now - OFFLINE_SYNC_WINDOW_DAYS * 86_400_000
    return at.getTime() <= now && at.getTime() >= oldest ? at : new Date(now)
  }

  async function add(ctx, { word_id, phrase_id, quality, direction, source = 'study', reviewed_at }) {
    const { userId } = ctx
    if (word_id && !(await findVisibleWord(pool, word_id, ctx))) throw notFound('Không tìm thấy từ.')
    if (phrase_id) {
      // Câu giao tiếp là sổ tay cá nhân: chỉ chủ sở hữu ghi được lượt ôn.
      const { rowCount } = await pool.query('select 1 from phrases where id = $1 and user_id = $2', [phrase_id, userId])
      if (!rowCount) throw notFound('Không tìm thấy câu giao tiếp.')
    }
    try {
      const { rows } = await pool.query(
        `insert into review_log (user_id, word_id, phrase_id, quality, direction, source, reviewed_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, word_id, phrase_id, quality, direction, source, reviewed_at`,
        [userId, word_id ?? null, phrase_id ?? null, quality, direction, source, resolveReviewedAt(reviewed_at)],
      )
      return rows[0]
    } catch (err) {
      if (err.code === '23503') throw notFound(word_id ? 'Không tìm thấy từ.' : 'Không tìm thấy câu giao tiếp.')
      throw err
    }
  }

  return { listMine, dailyCounts, add }
}
