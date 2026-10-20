import { randomInt } from 'node:crypto'
import { withTransaction } from '../../db/pool.js'
import { conflict, forbidden, notFound } from '../../lib/httpError.js'
import { assertWithinQuota } from '../../lib/quotas.js'
import { loadAccessContext } from '../access/accessContext.js'
import { canManageGroup, canRemoveMember, canViewGroup } from '../access/permissions.js'

// Mã mời: 8 ký tự ngẫu nhiên (crypto) từ bảng chữ đã bỏ các ký tự dễ nhầm (0/o, 1/l/i) —
// ~39 bit, kết hợp rate limit ở endpoint tham gia nên không dò được. Mã cũ tạo bằng md5
// (hex chữ thường) ở bản Supabase vẫn dùng được bình thường.
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export function generateInviteCode() {
  let code = ''
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return code
}

const groupNotFound = () => notFound('Không tìm thấy nhóm.')

export function createGroupsService({ pool, quotas }) {
  // Số nhóm 1 người tham gia (tạo mới hoặc vào bằng mã mời đều tính).
  const assertGroupQuota = (db, userId) =>
    assertWithinQuota(db, { table: 'group_members', userId, max: quotas.groups, what: 'nhóm' })

  // Chuyển 1 dòng groups thành dữ liệu trả về theo đúng quyền người xem:
  //   • my_role: vai trò của mình (null nếu là super admin không tham gia nhóm).
  //   • invite_code: CHỈ trưởng nhóm/super admin thấy (thành viên thường nhận null).
  //   • members: trưởng nhóm/super admin thấy cả nhóm (kèm email, tên hiển thị); thành viên chỉ thấy mình.
  function present(group, ctx, memberRows) {
    const manage = canManageGroup(group.id, ctx)
    return {
      id: group.id,
      name: group.name,
      created_by: group.created_by,
      created_at: group.created_at,
      invite_code: manage ? group.invite_code : null,
      my_role: ctx.roleByGroupId.get(group.id) ?? null,
      members: memberRows
        .filter((m) => m.group_id === group.id && (manage || m.user_id === ctx.userId))
        .map(({ user_id, role, joined_at, email, display_name }) => ({
          user_id,
          role,
          joined_at,
          email,
          display_name,
        })),
    }
  }

  async function membersOf(db, groupIds) {
    const { rows } = await db.query(
      `select gm.group_id, gm.user_id, gm.role, gm.joined_at, u.email, u.display_name
       from group_members gm join users u on u.id = gm.user_id
       where gm.group_id = any($1::uuid[])
       order by gm.joined_at asc, gm.user_id`,
      [groupIds],
    )
    return rows
  }

  // Luôn nạp LẠI ngữ cảnh quyền từ DB: hàm này chạy ngay sau khi thành viên/vai trò vừa đổi
  // (tạo nhóm, tham gia, đổi vai trò), nên req.access nạp ở đầu request đã cũ.
  async function presentOne(db, groupId, userId) {
    const ctx = await loadAccessContext(db, userId)
    const { rows } = await db.query('select * from groups where id = $1', [groupId])
    return present(rows[0], ctx, await membersOf(db, [groupId]))
  }

  async function list(ctx) {
    const { userId } = ctx
    const { rows: groups } = await pool.query(
      `select g.* from groups g
       where $2 or exists (select 1 from group_members gm where gm.group_id = g.id and gm.user_id = $1)
       order by g.created_at asc, g.id`,
      [userId, ctx.isSystemAdmin],
    )
    const members = await membersOf(
      pool,
      groups.map((g) => g.id),
    )
    return groups.map((g) => present(g, ctx, members))
  }

  // Tạo nhóm + tự thành trưởng nhóm, trong 1 transaction (thay cho RPC create_group).
  async function create({ userId }, { name }) {
    return withTransaction(pool, async (client) => {
      await assertGroupQuota(client, userId)
      let group
      for (let attempt = 1; !group; attempt++) {
        await client.query('savepoint new_code')
        try {
          const { rows } = await client.query(
            'insert into groups (name, invite_code, created_by) values ($1, $2, $3) returning *',
            [name, generateInviteCode(), userId],
          )
          group = rows[0]
        } catch (err) {
          // Trùng mã mời (cực hiếm) → thử mã khác.
          if (err.code !== '23505' || attempt >= 5) throw err
          await client.query('rollback to savepoint new_code')
        }
      }
      await client.query("insert into group_members (group_id, user_id, role) values ($1, $2, 'admin')", [
        group.id,
        userId,
      ])
      return presentOne(client, group.id, userId)
    })
  }

  // Tham gia bằng mã mời (thay cho RPC join_group). Đã là thành viên → giữ nguyên vai trò.
  async function join({ userId }, { code }) {
    const { rows } = await pool.query('select id from groups where invite_code = $1', [code])
    if (!rows[0]) throw notFound('Mã mời không đúng — kiểm tra lại với trưởng nhóm.')
    const { rows: already } = await pool.query('select 1 from group_members where group_id = $1 and user_id = $2', [
      rows[0].id,
      userId,
    ])
    if (!already[0]) await assertGroupQuota(pool, userId)
    await pool.query(
      `insert into group_members (group_id, user_id, role) values ($1, $2, 'member')
       on conflict (group_id, user_id) do nothing`,
      [rows[0].id, userId],
    )
    return presentOne(pool, rows[0].id, userId)
  }

  // Kiểm tra quyền quản lý nhóm: không xem được → 404, xem được nhưng không quản lý → 403.
  async function assertCanManage(ctx, groupId) {
    const { rows } = await pool.query('select 1 from groups where id = $1', [groupId])
    if (!rows[0] || !canViewGroup(groupId, ctx)) throw groupNotFound()
    if (!canManageGroup(groupId, ctx)) throw forbidden('Chỉ trưởng nhóm mới làm được thao tác này.')
    return ctx
  }

  async function rename(ctx, groupId, { name }) {
    await assertCanManage(ctx, groupId)
    await pool.query('update groups set name = $2 where id = $1', [groupId, name])
    return presentOne(pool, groupId, ctx.userId)
  }

  // Tạo mã mời mới — mã cũ ngừng hoạt động ngay (thay cho RPC regenerate_invite_code).
  async function regenerateInviteCode(ctx, groupId) {
    await assertCanManage(ctx, groupId)
    for (let attempt = 1; ; attempt++) {
      try {
        const { rows } = await pool.query('update groups set invite_code = $2 where id = $1 returning invite_code', [
          groupId,
          generateInviteCode(),
        ])
        return { invite_code: rows[0].invite_code }
      } catch (err) {
        if (err.code !== '23505' || attempt >= 5) throw err
      }
    }
  }

  // Khoá toàn bộ dòng thành viên của nhóm tới hết transaction, để 2 thao tác đồng thời (VD: 2
  // trưởng nhóm cùng rời) không cùng lúc "thấy vẫn còn trưởng nhóm khác" rồi để nhóm mất người
  // quản lý.
  async function lockMembers(client, groupId) {
    const { rows } = await client.query('select user_id, role from group_members where group_id = $1 for update', [
      groupId,
    ])
    return rows
  }

  // true nếu `targetUserId` là trưởng nhóm DUY NHẤT trong khi nhóm vẫn còn thành viên khác.
  function isLastAdminWithOthers(members, targetUserId) {
    const target = members.find((m) => m.user_id === targetUserId)
    if (target?.role !== 'admin') return false
    return members.filter((m) => m.role === 'admin').length === 1 && members.length > 1
  }

  // Rời nhóm (targetUserId = chính mình) hoặc mời thành viên khác ra.
  // Trưởng nhóm duy nhất KHÔNG rời được khi nhóm còn thành viên khác: phải chuyển quyền trưởng
  // nhóm trước (PATCH /groups/:id/members/:userId), để nhóm không bao giờ mất người quản lý.
  // Người cuối cùng trong nhóm thì rời tự do (không còn ai để chuyển quyền).
  async function removeMember(ctx, groupId, targetUserId) {
    const { userId } = ctx
    if (!canViewGroup(groupId, ctx)) throw groupNotFound()
    if (!canRemoveMember(groupId, targetUserId, ctx)) {
      throw forbidden('Chỉ trưởng nhóm mới mời được thành viên khác ra khỏi nhóm.')
    }
    await withTransaction(pool, async (client) => {
      const members = await lockMembers(client, groupId)
      if (!members.some((m) => m.user_id === targetUserId)) {
        throw notFound('Người này không phải thành viên của nhóm.')
      }
      if (isLastAdminWithOthers(members, targetUserId)) {
        throw conflict(
          'last_admin',
          targetUserId === userId
            ? 'Bạn là trưởng nhóm duy nhất — hãy chuyển quyền trưởng nhóm cho thành viên khác trước khi rời nhóm.'
            : 'Đây là trưởng nhóm duy nhất — hãy đặt thành viên khác làm trưởng nhóm trước.',
        )
      }
      await client.query('delete from group_members where group_id = $1 and user_id = $2', [groupId, targetUserId])
    })
  }

  // Đổi vai trò 1 thành viên (đặt làm trưởng nhóm / hạ xuống thành viên). Nhóm có thể có nhiều
  // trưởng nhóm; "chuyển quyền" = đặt người khác làm trưởng nhóm rồi tự hạ vai trò hoặc rời nhóm.
  // Không hạ được trưởng nhóm duy nhất.
  async function setMemberRole(ctx, groupId, targetUserId, { role }) {
    await assertCanManage(ctx, groupId)
    await withTransaction(pool, async (client) => {
      const members = await lockMembers(client, groupId)
      const target = members.find((m) => m.user_id === targetUserId)
      if (!target) throw notFound('Người này không phải thành viên của nhóm.')
      if (role === 'member' && target.role === 'admin' && members.filter((m) => m.role === 'admin').length === 1) {
        throw conflict('last_admin', 'Nhóm phải có ít nhất 1 trưởng nhóm — hãy đặt người khác làm trưởng nhóm trước.')
      }
      await client.query('update group_members set role = $3 where group_id = $1 and user_id = $2', [
        groupId,
        targetUserId,
        role,
      ])
    })
    return presentOne(pool, groupId, ctx.userId)
  }

  // Dashboard tiến độ: thống kê học của các THÀNH VIÊN HIỆN TẠI, CHỈ trên từ nằm trong chủ đề
  // dùng chung của nhóm này — không bao giờ tính trên từ cá nhân của ai, cũng không gồm người đã
  // rời nhóm. Tính GỘP ngay trong database và trả 1 dòng cho mỗi thành viên: kích thước phản hồi
  // chỉ phụ thuộc số thành viên, không phải (số thành viên × số từ) như bản /progress cũ.
  //   started  — số từ đã học ít nhất 1 lần (ở 1 trong 2 chiều)
  //   due      — số LƯỢT ôn đang đến hạn: từ chưa có tiến trình coi như đến hạn ngay; chiều
  //              Việt→Anh chỉ tính khi đã học chiều Anh→Việt (cùng luật với tab Học)
  async function stats(ctx, groupId) {
    await assertCanManage(ctx, groupId)
    const { rows } = await pool.query(
      `with shared as (
         select w.id from words w join decks d on d.id = w.deck_id where d.group_id = $1
       )
       select
         gm.user_id,
         (select count(*) from shared)::int as total_words,
         count(*) filter (where wp.repetitions > 0 or wp.repetitions_rev > 0)::int as started,
         (count(*) filter (where s.id is not null and coalesce(wp.due_at, now()) <= now())
          + count(*) filter (where wp.repetitions > 0 and coalesce(wp.due_at_rev, now()) <= now()))::int as due,
         coalesce(sum(wp.quiz_correct), 0)::int as quiz_correct,
         coalesce(sum(wp.quiz_wrong), 0)::int as quiz_wrong,
         greatest(max(wp.last_reviewed_at), max(wp.last_reviewed_at_rev)) as last_reviewed_at
       from group_members gm
       left join shared s on true
       left join word_progress wp on wp.word_id = s.id and wp.user_id = gm.user_id
       where gm.group_id = $1
       group by gm.user_id, gm.joined_at
       order by gm.joined_at asc, gm.user_id`,
      [groupId],
    )
    return rows
  }

  // Bản cũ: trả từng dòng tiến trình để client tự tính — chỉ còn để tương thích với bản FE cũ.
  async function progress(ctx, groupId) {
    await assertCanManage(ctx, groupId)
    const { rows } = await pool.query(
      `select wp.* from word_progress wp
       join words w on w.id = wp.word_id
       join decks d on d.id = w.deck_id
       join group_members gm on gm.group_id = d.group_id and gm.user_id = wp.user_id
       where d.group_id = $1`,
      [groupId],
    )
    return rows
  }

  return { list, create, join, rename, regenerateInviteCode, removeMember, setMemberRole, stats, progress }
}
