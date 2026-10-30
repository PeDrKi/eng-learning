// Thao tác trên TÀI KHOẢN dùng chung cho nhiều module (auth: tự xoá tài khoản; admin: super admin
// xoá tài khoản người khác) — đặt riêng ở đây để 2 module đó không phải import lẫn nhau.

// Xoá 1 người dùng trong transaction `client`, GIỮ nội dung dùng chung của nhóm — dùng chung cho
// "tự xoá tài khoản" (DELETE /auth/account) và "super admin xoá tài khoản" (module admin).
export async function deleteUserKeepingGroupContent(client, userId) {
  const { rows: memberships } = await client.query(
    'select group_id from group_members where user_id = $1 order by group_id',
    [userId],
  )
  for (const { group_id: groupId } of memberships) {
    // Khoá dòng thành viên của nhóm: không ai rời/đổi vai trò giữa lúc đang chọn người kế nhiệm.
    const { rows: members } = await client.query(
      'select user_id, role from group_members where group_id = $1 order by joined_at asc, user_id for update',
      [groupId],
    )
    const others = members.filter((m) => m.user_id !== userId)
    if (others.length === 0) {
      await client.query('delete from groups where id = $1', [groupId])
      continue
    }
    let successor = others.find((m) => m.role === 'admin')
    if (!successor) {
      successor = others[0]
      await client.query("update group_members set role = 'admin' where group_id = $1 and user_id = $2", [
        groupId,
        successor.user_id,
      ])
    }
    await client.query(
      `update words set user_id = $3
       where user_id = $1 and deck_id in (select id from decks where group_id = $2)`,
      [userId, groupId, successor.user_id],
    )
    // Collocation trong chủ đề nhóm là nội dung dùng chung như từ (câu giao tiếp thì không).
    await client.query(
      `update phrases set user_id = $3
       where user_id = $1 and kind <> 'phrase' and deck_id in (select id from decks where group_id = $2)`,
      [userId, groupId, successor.user_id],
    )
    for (const table of ['decks', 'chapters']) {
      await client.query(`update ${table} set user_id = $3 where user_id = $1 and group_id = $2`, [
        userId,
        groupId,
        successor.user_id,
      ])
    }
  }
  // Chủ đề nhóm mình tạo ở nhóm mình KHÔNG còn là thành viên (đã rời, hoặc super admin tạo
  // hộ): chuyển cho trưởng nhóm vào sớm nhất của nhóm đó; nhóm không còn trưởng nhóm nào thì
  // chủ đề bị xoá cùng tài khoản (từ bên trong về "chưa phân loại" của người đã thêm).
  // Chương của nhóm theo đúng luật đó.
  for (const table of ['decks', 'chapters']) {
    await client.query(
      `update ${table} d set user_id = a.user_id
       from (select distinct on (group_id) group_id, user_id from group_members
             where role = 'admin' and user_id <> $1 order by group_id, joined_at asc, user_id) a
       where d.user_id = $1 and d.group_id = a.group_id`,
      [userId],
    )
  }
  await client.query('delete from users where id = $1', [userId])
}
