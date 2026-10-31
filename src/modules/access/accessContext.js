import { accountDisabled, unauthorized } from '../../lib/httpError.js'
import { isSystemAdmin } from '../../lib/roles.js'

// Nạp "ngữ cảnh quyền" của người dùng cho 1 request: vai trò toàn hệ thống (isSystemAdmin =
// admin hoặc super admin — quản lý được mọi nhóm), và vai trò
// trong từng nhóm. Đọc thẳng từ DB mỗi request (không nhét vào JWT) để thay đổi quyền — bị
// mời ra khỏi nhóm, bị gỡ quyền admin — có hiệu lực NGAY, không phải chờ token hết hạn.
export async function loadAccessContext(db, userId) {
  const { rows } = await db.query(
    `select u.role as system_role, u.disabled_at, gm.group_id, gm.role
     from users u
     left join group_members gm on gm.user_id = u.id
     where u.id = $1`,
    [userId],
  )
  if (rows.length === 0) throw unauthorized('invalid_token', 'Tài khoản không còn tồn tại.')
  if (rows[0].disabled_at) throw accountDisabled()
  const roleByGroupId = new Map()
  for (const r of rows) if (r.group_id) roleByGroupId.set(r.group_id, r.role)
  // Chủ đề cộng đồng đã "Lưu vào thư viện" (migration 023) — xem được và học được như chủ đề nhóm.
  const { rows: follows } = await db.query('select deck_id from deck_follows where user_id = $1', [userId])
  const followedDeckIds = new Set(follows.map((f) => f.deck_id))
  return {
    userId,
    role: rows[0].system_role,
    isSystemAdmin: isSystemAdmin(rows[0].system_role),
    roleByGroupId,
    followedDeckIds,
  }
}

// Điều kiện SQL tương đương canViewDeck() — dùng cho truy vấn DANH SÁCH (lọc ngay trong DB
// thay vì tải hết rồi lọc bằng JS). $1 = userId, $2 = isSystemAdmin. `d` là alias bảng decks.
// Test tích hợp đối chiếu kết quả với canViewDeck() để 2 nơi luôn khớp nhau.
export const SQL_CAN_VIEW_DECK = `(
  (d.group_id is null and d.user_id = $1)
  or (d.group_id is not null and ($2 or exists (
    select 1 from group_members gm where gm.group_id = d.group_id and gm.user_id = $1
  )))
)`

// Như SQL_CAN_VIEW_DECK nhưng cho bảng decks, thêm chủ đề cộng đồng đã "Lưu vào thư viện" —
// tương đương canViewDeck() khi có ctx.followedDeckIds. (SQL_CAN_VIEW_DECK còn dùng cho bảng
// chapters, nơi không có khái niệm theo dõi.)
export const SQL_DECK_IN_LIBRARY = `(${SQL_CAN_VIEW_DECK}
  or (d.group_id is null and d.hidden_at is null and exists (
    select 1 from deck_follows f where f.deck_id = d.id and f.user_id = $1
  ))
)`
