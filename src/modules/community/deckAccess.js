// Ai "quản lý" một chủ đề ở cộng đồng (bật/tắt chia sẻ, duyệt đề xuất, xoá nhận xét, nhận thông
// báo): chủ đề cá nhân → chủ sở hữu; chủ đề nhóm → mọi trưởng nhóm của nhóm đó (super admin cũng
// được, như luật canManageDeck ở access/permissions.js). `d` là alias bảng decks.
export const sqlIsManager = (userParam, sysAdminParam) => `(case when d.group_id is null then d.user_id = ${userParam}
  else (${sysAdminParam} or exists (select 1 from group_members gm
         where gm.group_id = d.group_id and gm.user_id = ${userParam} and gm.role = 'admin')) end)`

// Thành viên (mọi vai trò) của nhóm sở hữu chủ đề — họ học chủ đề nhóm như trước, không cần "lưu".
export const sqlIsGroupMember = (userParam) =>
  `(d.group_id is not null and exists (select 1 from group_members gm
     where gm.group_id = d.group_id and gm.user_id = ${userParam}))`

// Những người nhận thông báo về 1 chủ đề: chủ sở hữu (cá nhân) hoặc mọi trưởng nhóm (nhóm).
export async function managersOf(db, deckId) {
  const { rows } = await db.query(
    `select d.user_id from decks d where d.id = $1 and d.group_id is null
     union
     select gm.user_id from decks d join group_members gm on gm.group_id = d.group_id
      where d.id = $1 and gm.role = 'admin'`,
    [deckId],
  )
  return rows.map((r) => r.user_id)
}
