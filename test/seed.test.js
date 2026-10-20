import { beforeEach, describe, expect, it } from 'vitest'
import { ACCOUNTS, DEMO_PASSWORD, GROUPS } from '../src/db/seedData.js'
import { assertSafeTarget, isLocalDatabase, seed } from '../src/db/seed.js'
import { verifyPassword } from '../src/lib/password.js'
import { setupTestApp } from './helpers.js'

// Script đổ dữ liệu mẫu là thứ người ta chạy ngay sau khi cài mới — hỏng thì ấn tượng đầu tiên về
// dự án là một dòng stack trace. Nó cũng GHI vào database, nên hai thứ phải được giữ chặt:
// chạy nhầm chỗ, và đụng vào dữ liệu không phải của nó.

const { pool } = setupTestApp()

describe('seed — chặn chạy nhầm database', () => {
  it('nhận ra database ở máy mình', () => {
    expect(isLocalDatabase('postgres://u:p@localhost:5432/db')).toBe(true)
    expect(isLocalDatabase('postgres://u:p@127.0.0.1:5433/db')).toBe(true)
    expect(isLocalDatabase('postgres://u:p@ep-abc.aws.neon.tech/db')).toBe(false)
    expect(isLocalDatabase('khong-phai-url')).toBe(false)
  })

  it('database từ xa bị chặn, trừ khi gõ đúng câu xác nhận', () => {
    const remote = 'postgres://u:p@ep-abc.aws.neon.tech/db'
    expect(() => assertSafeTarget(remote)).toThrow(/không trỏ tới máy mình/)
    expect(() => assertSafeTarget(remote, 'yes')).toThrow() // gần đúng vẫn không được
    expect(() => assertSafeTarget(remote, 'toi-chac-chan')).not.toThrow()
    expect(() => assertSafeTarget('postgres://u:p@localhost/db')).not.toThrow()
  })
})

describe('seed — dữ liệu tạo ra', () => {
  let nguoiLa

  // `setupTestApp` xoá sạch bảng trước MỖI test, nên phải đổ lại dữ liệu mẫu cho từng test chứ
  // không gom vào beforeAll. 30 từ nên mỗi lần chỉ hơn một giây.
  beforeEach(async () => {
    // Một tài khoản KHÔNG phải của seed, có sẵn từ vựng riêng — để chứng minh seed không đụng tới.
    const { rows } = await pool.query(
      "insert into users (email, password_hash, role) values ('nguoi-that@vidu.com', 'hash', 'user') returning id",
    )
    nguoiLa = rows[0].id
    await pool.query(
      "insert into words (user_id, word, meaning, tags) values ($1, 'untouched', 'không được đụng', '{}')",
      [nguoiLa],
    )
    await pool.query('update word_progress set lapses = 9 where user_id = $1', [nguoiLa])

    await seed(pool, { nWords: 30, log: () => {} })
  }, 60000)

  it('tạo đủ các vai trò: user, admin, super admin, và một tài khoản bị khoá', async () => {
    const { rows } = await pool.query('select email, role, disabled_at from users where email like $1 order by email', [
      '%@tuvung.test',
    ])
    expect(rows).toHaveLength(ACCOUNTS.length)
    expect(rows.map((r) => r.role).toSorted()).toEqual(ACCOUNTS.map((a) => a.role).toSorted())
    expect(rows.filter((r) => r.disabled_at).map((r) => r.email)).toEqual(['khoa@tuvung.test'])
  })

  it('mật khẩu dùng được thật (băm bcrypt, không phải chuỗi thường)', async () => {
    const { rows } = await pool.query("select password_hash from users where email = 'hoc@tuvung.test'")
    expect(await verifyPassword(DEMO_PASSWORD, rows[0].password_hash)).toBe(true)
    expect(await verifyPassword('sai-mat-khau', rows[0].password_hash)).toBe(false)
  })

  // Lý do tồn tại của dữ liệu mẫu: mở app lên là học được ngay, không phải tự thêm từ trước.
  it('người học chính có thẻ ĐẾN HẠN, có từ mới, và có từ "khó nhớ" đã gắn nhãn', async () => {
    const { rows } = await pool.query(
      `select
         count(*) filter (where wp.due_at <= now())::int as den_han,
         count(*) filter (where wp.repetitions = 0)::int as moi,
         count(*) filter (where wp.lapses >= 6)::int as kho_nho,
         count(*) filter (where 'khó nhớ' = any(w.tags))::int as co_nhan
       from word_progress wp join words w on w.id = wp.word_id
       join users u on u.id = wp.user_id where u.email = 'hoc@tuvung.test'`,
    )
    expect(rows[0].den_han).toBeGreaterThan(0)
    expect(rows[0].moi).toBeGreaterThan(0)
    expect(rows[0].kho_nho).toBeGreaterThan(0)
    expect(rows[0].co_nhan).toBeGreaterThanOrEqual(rows[0].kho_nho)
  })

  it('có lịch sử ôn tới tận hôm nay để chuỗi ngày học hiện ra', async () => {
    const { rows } = await pool.query(
      `select count(*)::int as hom_nay from review_log r join users u on u.id = r.user_id
        where u.email = 'hoc@tuvung.test' and r.reviewed_at::date = now()::date`,
    )
    expect(rows[0].hom_nay).toBeGreaterThan(0)
  })

  // Một lượt ôn ở tương lai làm sai số liệu "hôm nay" và vẽ ra cột biểu đồ chưa từng xảy ra.
  it('không có lượt ôn nào nằm ở tương lai', async () => {
    const { rows } = await pool.query('select count(*)::int as n from review_log where reviewed_at > now()')
    expect(rows[0].n).toBe(0)
  })

  it('câu giao tiếp có tiến trình học (trigger tạo sẵn) và có câu đến hạn', async () => {
    const { rows } = await pool.query(
      `select count(*)::int as tong, count(*) filter (where pp.due_at <= now())::int as den_han
         from phrase_progress pp join users u on u.id = pp.user_id where u.email = 'hoc@tuvung.test'`,
    )
    expect(rows[0].tong).toBeGreaterThan(0)
    expect(rows[0].den_han).toBeGreaterThan(0)
  })

  it('tài khoản để xem thử không có từ lặp kiểu "landmark (2)" — chỉ tài khoản đo tải mới lặp', async () => {
    const { rows } = await pool.query(
      `select u.email, count(*)::int as n from words w join users u on u.id = w.user_id
        where u.email like '%@tuvung.test' and u.email <> 'nang@tuvung.test' and w.word ~ ' \\(\\d+\\)$'
        group by u.email`,
    )
    expect(rows).toEqual([])
  })

  it('tài khoản mới tinh thật sự trống — để xem được màn chào', async () => {
    const { rows } = await pool.query(
      `select (select count(*) from words w where w.user_id = u.id)::int as tu,
              (select count(*) from decks d where d.user_id = u.id)::int as chu_de
         from users u where u.email = 'moi@tuvung.test'`,
    )
    expect(rows[0]).toEqual({ tu: 0, chu_de: 0 })
  })

  it('N_WORDS quyết định số từ của tài khoản "người học nặng"', async () => {
    const { rows } = await pool.query(
      "select count(*)::int as n from words w join users u on u.id = w.user_id where u.email = 'nang@tuvung.test'",
    )
    expect(rows[0].n).toBe(30)
  })

  it('có nhóm, có thành viên và có chủ đề dùng chung', async () => {
    const { rows } = await pool.query(
      `select g.invite_code, count(m.user_id)::int as thanh_vien,
              (select count(*) from decks d where d.group_id = g.id)::int as chu_de_chung
         from groups g left join group_members m on m.group_id = g.id
        where g.invite_code = any($1) group by g.id order by g.invite_code`,
      [GROUPS.map((x) => x.invite_code)],
    )
    expect(rows).toHaveLength(GROUPS.length)
    for (const r of rows) {
      expect(r.thanh_vien).toBeGreaterThan(1)
      expect(r.chu_de_chung).toBe(1)
    }
  })

  it('KHÔNG đụng tới tài khoản không phải của nó', async () => {
    const { rows } = await pool.query('select word, tags from words where user_id = $1', [nguoiLa])
    expect(rows).toEqual([{ word: 'untouched', tags: [] }])
    const { rows: still } = await pool.query('select count(*)::int as n from users where id = $1', [nguoiLa])
    expect(still[0].n).toBe(1)
  })

  // Chạy lại là chuyện bình thường (thêm từ vào danh sách mẫu rồi chạy lại). Phải ra kết quả như
  // cũ, không nhân đôi dữ liệu và không vỡ vì trùng email/mã mời.
  it('chạy lại lần nữa cho cùng kết quả, không nhân đôi', async () => {
    const dem = async () =>
      (
        await pool.query(
          `select (select count(*) from users where email like '%@tuvung.test')::int as nguoi,
                  (select count(*) from words w join users u on u.id = w.user_id
                    where u.email like '%@tuvung.test')::int as tu,
                  (select count(*) from groups where invite_code = any($1))::int as nhom`,
          [GROUPS.map((x) => x.invite_code)],
        )
      ).rows[0]
    const truoc = await dem()
    await seed(pool, { nWords: 30, log: () => {} })
    expect(await dem()).toEqual(truoc)
  }, 120000)
})
