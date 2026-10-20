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
  return { userId, role: rows[0].system_role, isSystemAdmin: isSystemAdmin(rows[0].system_role), roleByGroupId }
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
