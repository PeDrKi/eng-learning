import { badRequest, notFound } from '../../lib/httpError.js'
import { sqlPublicIdentity } from '../../lib/publicName.js'
import { isSuperAdmin } from '../../lib/roles.js'

// Kiểm duyệt cộng đồng (chỉ super admin — router gắn sau requireSuperAdmin): xem báo cáo vi phạm,
// ẩn / bỏ ẩn chủ đề và nhận xét, chặn / bỏ chặn người dùng khỏi các thao tác cộng đồng. Ẩn một nội
// dung thì tự đóng (resolved) mọi báo cáo đang mở về nội dung đó.

// Tóm tắt nội dung bị báo cáo, kèm id người tạo ra nó (để chặn) — mọi loại nội dung về cùng 1 dạng.
const TARGET_SUMMARY = `
  case r.target_type
    when 'deck' then (select jsonb_build_object('title', d.name, 'text', d.description, 'deck_id', d.id,
                       'owner_id', d.user_id, 'hidden', d.hidden_at is not null) from decks d where d.id = r.target_id)
    when 'comment' then (select jsonb_build_object('title', d.name, 'text', c.body, 'deck_id', c.deck_id,
                       'owner_id', c.user_id, 'hidden', c.deleted_at is not null)
                       from comments c join decks d on d.id = c.deck_id where c.id = r.target_id)
    when 'suggestion' then (select jsonb_build_object('title', d.name,
                       'text', coalesce(s.proposed->>'word', s.base->>'word', '') || ' — ' || s.reason,
                       'deck_id', s.deck_id, 'owner_id', s.user_id, 'hidden', false)
                       from edit_suggestions s join decks d on d.id = s.deck_id where s.id = r.target_id)
  end`

export function createModerationService({ pool }) {
  async function listReports({ status }) {
    const { rows } = await pool.query(
      `select r.id, r.target_type, r.target_id, r.reason, r.status, r.created_at, r.resolved_at,
              ${sqlPublicIdentity('reporter')}, ${TARGET_SUMMARY} as target
         from reports r join users u on u.id = r.reporter_id
        where ($1 = 'all' or r.status = $1)
        order by r.created_at desc
        limit 200`,
      [status],
    )
    // Thêm tên công khai + trạng thái chặn của người tạo ra nội dung bị báo cáo.
    const ownerIds = [...new Set(rows.map((r) => r.target?.owner_id).filter(Boolean))]
    const { rows: owners } = await pool.query(
      `select u.id, ${sqlPublicIdentity('owner')}, (u.community_blocked_at is not null) as blocked
         from users u where u.id = any($1::uuid[])`,
      [ownerIds],
    )
    const ownerById = new Map(owners.map((o) => [o.id, o]))
    return rows.map((r) => {
      const o = r.target && ownerById.get(r.target.owner_id)
      return {
        ...r,
        target: r.target && {
          ...r.target,
          owner_name: o?.owner_name ?? null,
          owner_tag: o?.owner_tag ?? null,
          owner_blocked: Boolean(o?.blocked),
        },
      }
    })
  }

  async function closeReport(ctx, id, { status }) {
    const { rowCount } = await pool.query(
      `update reports set status = $2, resolved_by = $3, resolved_at = now() where id = $1 and status = 'open'`,
      [id, status, ctx.userId],
    )
    if (!rowCount) throw notFound('Không tìm thấy báo cáo đang mở.')
  }

  const resolveReportsFor = (ctx, type, id) =>
    pool.query(
      `update reports set status = 'resolved', resolved_by = $3, resolved_at = now()
        where target_type = $1 and target_id = $2 and status = 'open'`,
      [type, id, ctx.userId],
    )

  async function setDeckHidden(ctx, deckId, hidden) {
    const { rowCount } = await pool.query(
      hidden
        ? 'update decks set hidden_at = now(), hidden_by = $2 where id = $1 and group_id is null'
        : 'update decks set hidden_at = null, hidden_by = null where id = $1 and group_id is null',
      hidden ? [deckId, ctx.userId] : [deckId],
    )
    if (!rowCount) throw notFound('Không tìm thấy chủ đề.')
    if (hidden) await resolveReportsFor(ctx, 'deck', deckId)
  }

  async function setCommentHidden(ctx, commentId, hidden) {
    const { rowCount } = await pool.query(
      hidden
        ? 'update comments set deleted_at = now(), deleted_by = $2 where id = $1'
        : 'update comments set deleted_at = null, deleted_by = null where id = $1',
      hidden ? [commentId, ctx.userId] : [commentId],
    )
    if (!rowCount) throw notFound('Không tìm thấy nhận xét.')
    if (hidden) await resolveReportsFor(ctx, 'comment', commentId)
  }

  async function setUserBlocked(ctx, userId, blocked) {
    const { rows } = await pool.query('select role from users where id = $1', [userId])
    if (!rows[0]) throw notFound('Không tìm thấy người dùng.')
    if (blocked && (userId === ctx.userId || isSuperAdmin(rows[0].role))) {
      throw badRequest('cannot_block_admin', 'Không chặn được super admin.')
    }
    await pool.query('update users set community_blocked_at = $2 where id = $1', [userId, blocked ? new Date() : null])
  }

  return { listReports, closeReport, setDeckHidden, setCommentHidden, setUserBlocked }
}
