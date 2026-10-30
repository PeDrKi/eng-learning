import { z } from 'zod'
import { withTransaction } from '../../db/pool.js'
import { badRequest, forbidden, notFound } from '../../lib/httpError.js'
import { decodeCursor, toPage } from '../../lib/pagination.js'
import { isSuperAdmin, isSystemAdmin } from '../../lib/roles.js'
import { deleteUserKeepingGroupContent } from '../users/deleteUser.js'

// Quản trị tài khoản — CHỈ super admin (app.js gắn requireSuperAdmin trước router của module này).
//
// Luật an toàn (đều có test):
//   • Không tự đổi vai trò / tự khoá / tự xoá chính mình ở đây → super admin không tự khoá mình
//     ra ngoài, và hệ thống luôn còn ít nhất 1 super admin đang hoạt động.
//   • Không đụng được tới super admin KHÁC (đổi vai trò, khoá, xoá) — tránh 2 super admin "đá"
//     nhau; việc đó phải làm bằng SQL.
//   • Mọi thao tác ghi đều được ghi vào console log của server kèm ai làm, làm gì, với ai.

const DEFAULT_PAGE_SIZE = 50

const userCursor = z.object({ c: z.string().max(64), id: z.uuid() })

// Cột trả ra cho trang quản trị — không bao giờ gồm password_hash.
const ADMIN_USER_COLUMNS = `
  u.id, u.email, u.display_name, u.role, u.created_at, u.disabled_at,
  (select count(*)::int from words w where w.user_id = u.id) as word_count,
  (select max(t.created_at) from refresh_tokens t where t.user_id = u.id) as last_active_at`

const present = ({ cursor_key, ...row }) => {
  void cursor_key
  return { ...row, is_admin: isSystemAdmin(row.role), is_super_admin: isSuperAdmin(row.role) }
}

const escapeLike = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`)

// Số liệu tổng quan chỉ gồm con số gộp toàn hệ thống — không có dữ liệu của riêng người nào, nên
// không mâu thuẫn với nguyên tắc "không ai xem được dữ liệu cá nhân của người khác".
const OVERVIEW_TOTALS_SQL = `
  with b as (
    select date_trunc('day', now() at time zone $1) at time zone $1 as today_start
  )
  select
    (select count(*)::int from users) as users,
    (select count(*)::int from users where role in ('admin', 'super_admin')) as admins,
    (select count(*)::int from users where disabled_at is not null) as disabled_users,
    (select count(*)::int from groups) as groups,
    (select count(*)::int from decks) as decks,
    (select count(*)::int from words) as words,
    (select count(*)::int from phrases where kind = 'phrase') as phrases,
    (select count(*)::int from users, b where created_at >= b.today_start - interval '6 days') as new_users_7d,
    (select count(*)::int from users, b where created_at >= b.today_start - interval '29 days') as new_users_30d,
    (select count(distinct user_id)::int from review_log, b where reviewed_at >= b.today_start) as active_today,
    (select count(distinct user_id)::int from review_log, b
      where reviewed_at >= b.today_start - interval '6 days') as active_7d,
    (select count(distinct user_id)::int from review_log, b
      where reviewed_at >= b.today_start - interval '29 days') as active_30d,
    (select count(*)::int from review_log, b where reviewed_at >= b.today_start) as reviews_today,
    (select count(*)::int from review_log, b
      where reviewed_at >= b.today_start - interval '6 days') as reviews_7d`

// Mỗi ngày 1 dòng (kể cả ngày không có gì → 0), ngày tính theo múi giờ báo cáo.
const OVERVIEW_DAILY_SQL = `
  with b as (
    select date_trunc('day', now() at time zone $1) as today_local
  ),
  days as (
    select generate_series(today_local - ($2::int - 1) * interval '1 day', today_local, interval '1 day') as d from b
  ),
  r as (
    select date_trunc('day', reviewed_at at time zone $1) as d,
           count(*)::int as reviews, count(distinct user_id)::int as active_users
    from review_log, b
    where reviewed_at >= (today_local - ($2::int - 1) * interval '1 day') at time zone $1
    group by 1
  ),
  u as (
    select date_trunc('day', created_at at time zone $1) as d, count(*)::int as new_users
    from users, b
    where created_at >= (today_local - ($2::int - 1) * interval '1 day') at time zone $1
    group by 1
  )
  select to_char(days.d, 'YYYY-MM-DD') as date,
         coalesce(u.new_users, 0) as new_users,
         coalesce(r.active_users, 0) as active_users,
         coalesce(r.reviews, 0) as reviews
  from days left join r on r.d = days.d left join u on u.d = days.d
  order by days.d`

export function createAdminService({ pool, log = console.log, timeZone = 'Asia/Ho_Chi_Minh', overviewCacheMs = 0 }) {
  // Nhớ kết quả tổng quan trong chốc lát: các câu đếm quét bảng lớn, mà trang này có thể bị mở/tải
  // lại liên tục. Nhớ theo từng tiến trình là đủ (số liệu chậm vài chục giây không sao).
  const overviewCache = new Map()

  async function getOverview({ days = 30 } = {}) {
    const hit = overviewCache.get(days)
    if (hit && hit.expiresAt > Date.now()) return hit.value
    const [totals, daily] = await Promise.all([
      pool.query(OVERVIEW_TOTALS_SQL, [timeZone]),
      pool.query(OVERVIEW_DAILY_SQL, [timeZone, days]),
    ])
    const t = totals.rows[0]
    const value = {
      generated_at: new Date().toISOString(),
      time_zone: timeZone,
      totals: {
        users: t.users,
        admins: t.admins,
        disabled_users: t.disabled_users,
        groups: t.groups,
        decks: t.decks,
        words: t.words,
        phrases: t.phrases,
      },
      new_users: { last_7_days: t.new_users_7d, last_30_days: t.new_users_30d },
      active_users: { today: t.active_today, last_7_days: t.active_7d, last_30_days: t.active_30d },
      reviews: { today: t.reviews_today, last_7_days: t.reviews_7d },
      daily: daily.rows,
    }
    if (overviewCacheMs > 0) overviewCache.set(days, { value, expiresAt: Date.now() + overviewCacheMs })
    return value
  }

  // Dấu vết kiểm tra tối thiểu: ai (super admin nào) làm gì với tài khoản nào. Không ghi dữ liệu
  // nhạy cảm (mật khẩu, token). Xem trong log của nơi host BE.
  const audit = (actorId, action, target, detail = {}) =>
    log(
      `[admin] ${JSON.stringify({ at: new Date().toISOString(), actor: actorId, action, target: target.id, email: target.email, ...detail })}`,
    )

  // Danh sách tài khoản, mới đăng ký trước. Phân trang kiểu con trỏ như GET /words.
  async function listUsers({ limit = DEFAULT_PAGE_SIZE, cursor, q } = {}) {
    const after = decodeCursor(cursor, userCursor)
    let rows
    try {
      ;({ rows } = await pool.query(
        `select ${ADMIN_USER_COLUMNS}, u.created_at::text as cursor_key
         from users u
         where ($1::text is null or u.email ilike $1 or u.display_name ilike $1)
           and ($2::timestamptz is null
                or u.created_at < $2::timestamptz
                or (u.created_at = $2::timestamptz and u.id > $3::uuid))
         order by u.created_at desc, u.id
         limit $4`,
        [q ? `%${escapeLike(q)}%` : null, after?.c ?? null, after?.id ?? null, limit + 1],
      ))
    } catch (err) {
      if (err.code === '22007' || err.code === '22008') throw badRequest('invalid_cursor', 'cursor không hợp lệ.')
      throw err
    }
    const page = toPage(rows, limit, (r) => ({ c: r.cursor_key, id: r.id }))
    return { items: page.items.map(present), next_cursor: page.next_cursor }
  }

  // Lấy (và khoá dòng) người dùng đích, kiểm tra các luật an toàn chung cho mọi thao tác ghi.
  async function lockTarget(client, actorId, targetId) {
    if (targetId === actorId) throw forbidden('Không tự thao tác trên tài khoản của chính mình ở trang quản trị.')
    const { rows } = await client.query('select id, email, role from users where id = $1 for update', [targetId])
    if (!rows[0]) throw notFound('Không tìm thấy tài khoản.')
    if (isSuperAdmin(rows[0].role)) throw forbidden('Không thao tác được trên tài khoản super admin khác.')
    return rows[0]
  }

  // Bổ nhiệm / gỡ admin (role) và khoá / mở khoá (disabled). Khoá → đăng xuất mọi thiết bị ngay.
  async function updateUser(actorId, targetId, { role, disabled }) {
    return withTransaction(pool, async (client) => {
      const target = await lockTarget(client, actorId, targetId)
      await client.query(
        `update users set
           role = coalesce($2, role),
           disabled_at = case when $3::boolean is null then disabled_at
                              when $3 then coalesce(disabled_at, now())
                              else null end,
           updated_at = now()
         where id = $1`,
        [targetId, role ?? null, disabled ?? null],
      )
      if (disabled) {
        await client.query('update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null', [
          targetId,
        ])
      }
      const { rows } = await client.query(`select ${ADMIN_USER_COLUMNS} from users u where u.id = $1`, [targetId])
      audit(actorId, 'update_user', target, { role, disabled })
      return present(rows[0])
    })
  }

  // Xoá vĩnh viễn tài khoản người khác — nội dung dùng chung của nhóm được giữ lại cho nhóm
  // (cùng luật với việc tự xoá tài khoản).
  async function deleteUser(actorId, targetId) {
    await withTransaction(pool, async (client) => {
      const target = await lockTarget(client, actorId, targetId)
      await deleteUserKeepingGroupContent(client, targetId)
      audit(actorId, 'delete_user', target)
    })
  }

  return { listUsers, updateUser, deleteUser, getOverview }
}
