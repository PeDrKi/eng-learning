import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, createUser, makeAdmin, makeSuperAdmin, refreshCookieOf, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()

// alice: trưởng nhóm, bob: thành viên, carol: người ngoài, sam: SUPER ADMIN (xem buildWorld).
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const PASSWORD = 'matkhau123'
const login = (email) => request(app).post('/auth/login').send({ email, password: PASSWORD })
const setUser = (actor, target, body) => actor.patch(`/admin/users/${target.id}`, body)

describe('Vai trò toàn hệ thống: user / admin / super admin', () => {
  it('GET /auth/me trả vai trò và 2 cờ suy ra từ vai trò', async () => {
    await makeAdmin(pool, w.carol)
    expect((await w.bob.get('/auth/me')).body.user).toMatchObject({
      role: 'user',
      is_admin: false,
      is_super_admin: false,
    })
    expect((await w.carol.get('/auth/me')).body.user).toMatchObject({
      role: 'admin',
      is_admin: true,
      is_super_admin: false,
    })
    expect((await w.sam.get('/auth/me')).body.user).toMatchObject({
      role: 'super_admin',
      is_admin: true,
      is_super_admin: true,
    })
  })

  it('admin quản lý được MỌI nhóm và nội dung nhóm như super admin, nhưng không thấy dữ liệu cá nhân của ai', async () => {
    await makeAdmin(pool, w.carol) // carol không thuộc nhóm nào
    expect((await w.carol.get('/groups')).body.map((g) => g.id)).toContain(w.groupId)
    expect((await w.carol.patch(`/groups/${w.groupId}`, { name: 'Admin đổi tên' })).status).toBe(200)
    expect((await w.carol.post('/decks', { name: 'Admin tạo', group_id: w.groupId })).status).toBe(201)
    expect((await w.carol.patch(`/words/${w.words.bobInGroup.id}`, { meaning: 'sửa' })).status).toBe(200)
    expect((await w.carol.get(`/groups/${w.groupId}/progress`)).status).toBe(200)
    // dữ liệu cá nhân của người khác vẫn kín
    expect((await w.carol.patch(`/words/${w.words.alicePersonal.id}`, { meaning: 'x' })).status).toBe(404)
    expect((await w.carol.get('/words')).body.map((x) => x.word)).not.toContain('apple')
  })

  it('bị gỡ quyền admin → mất quyền quản lý nhóm NGAY, không chờ token hết hạn', async () => {
    await makeAdmin(pool, w.carol)
    expect((await w.carol.patch(`/groups/${w.groupId}`, { name: 'x' })).status).toBe(200)
    expect((await setUser(w.sam, w.carol, { role: 'user' })).status).toBe(200)
    expect((await w.carol.patch(`/groups/${w.groupId}`, { name: 'y' })).status).toBe(404)
  })
})

describe('/admin — chỉ super admin', () => {
  it('admin và người dùng thường đều bị từ chối (403); chưa đăng nhập → 401', async () => {
    await makeAdmin(pool, w.carol)
    for (const who of [w.carol, w.alice, w.bob]) {
      expect((await who.get('/admin/users')).status).toBe(403)
      expect((await setUser(who, w.bob, { role: 'admin' })).status).toBe(403)
      expect((await who.del(`/admin/users/${w.bob.id}`)).status).toBe(403)
    }
    expect((await request(app).get('/admin/users')).status).toBe(401)
    expect((await w.bob.get('/auth/me')).body.user.role).toBe('user') // không ai tự leo quyền được
  })

  it('GET /admin/users: liệt kê tài khoản kèm vai trò, số từ, trạng thái khoá; không lộ mật khẩu', async () => {
    const res = await w.sam.get('/admin/users')
    expect(res.status).toBe(200)
    expect(res.body.next_cursor).toBeNull()
    expect(res.body.items).toHaveLength(4)
    const bob = res.body.items.find((u) => u.email === 'bob@example.com')
    expect(bob).toMatchObject({ role: 'user', is_admin: false, disabled_at: null, word_count: 3 })
    expect(bob.last_active_at).toBeTruthy()
    expect(Object.keys(bob).toSorted()).toEqual([
      'created_at',
      'disabled_at',
      'display_name',
      'email',
      'id',
      'is_admin',
      'is_super_admin',
      'last_active_at',
      'role',
      'word_count',
    ])
  })

  it('tìm theo email (không phân biệt hoa/thường; ký tự % _ được coi là chữ thường) và phân trang', async () => {
    expect((await w.sam.get('/admin/users?q=BOB')).body.items.map((u) => u.email)).toEqual(['bob@example.com'])
    await w.bob.put('/auth/profile').send({ display_name: 'Bình Minh' })
    expect((await w.sam.get('/admin/users?q=bình')).body.items.map((u) => u.email)).toEqual(['bob@example.com'])
    expect((await w.sam.get('/admin/users?q=%25')).body.items).toEqual([])

    const seen = []
    let cursor
    do {
      const res = await w.sam.get(`/admin/users?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
      seen.push(...res.body.items.map((u) => u.email))
      cursor = res.body.next_cursor
    } while (cursor)
    expect(seen.toSorted()).toEqual(['alice@example.com', 'bob@example.com', 'carol@example.com', 'sam@example.com'])
  })

  it('bổ nhiệm rồi gỡ admin', async () => {
    const up = await setUser(w.sam, w.bob, { role: 'admin' })
    expect(up.status).toBe(200)
    expect(up.body).toMatchObject({ email: 'bob@example.com', role: 'admin', is_admin: true })
    expect((await setUser(w.sam, w.bob, { role: 'user' })).body.role).toBe('user')
  })

  it('không cấp được super_admin qua API; dữ liệu sai → 400; tài khoản không tồn tại → 404', async () => {
    expect((await setUser(w.sam, w.bob, { role: 'super_admin' })).status).toBe(400)
    expect((await setUser(w.sam, w.bob, {})).status).toBe(400)
    expect((await setUser(w.sam, w.bob, { disabled: 'yes' })).status).toBe(400)
    const ghost = { id: '00000000-0000-4000-8000-000000000000' }
    expect((await setUser(w.sam, ghost, { role: 'admin' })).status).toBe(404)
    expect((await w.sam.del(`/admin/users/${ghost.id}`)).status).toBe(404)
  })

  it('không tự thao tác trên chính mình, không đụng được super admin khác', async () => {
    const sue = await createUser(app, 'sue@example.com')
    await makeSuperAdmin(pool, sue)
    for (const target of [w.sam, sue]) {
      expect((await setUser(w.sam, target, { role: 'user' })).status).toBe(403)
      expect((await setUser(w.sam, target, { disabled: true })).status).toBe(403)
      expect((await w.sam.del(`/admin/users/${target.id}`)).status).toBe(403)
    }
    expect((await sue.get('/admin/users')).status).toBe(200)
  })
})

describe('Khoá / mở khoá tài khoản', () => {
  it('khoá → mất quyền NGAY trên mọi endpoint, không đăng nhập/gia hạn/đặt lại mật khẩu được; mở khoá → dùng lại bình thường', async () => {
    const session = await login('bob@example.com')
    const locked = await setUser(w.sam, w.bob, { disabled: true })
    expect(locked.body.disabled_at).toBeTruthy()

    for (const path of ['/auth/me', '/decks', '/words', '/progress', '/settings', '/phrases', '/groups']) {
      const res = await w.bob.get(path)
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('account_disabled')
    }
    const again = await login('bob@example.com')
    expect(again.status).toBe(403)
    expect(again.body.error.code).toBe('account_disabled')
    expect(
      (
        await request(app)
          .post('/auth/refresh')
          .set('Cookie', `tv_refresh=${refreshCookieOf(session)}`)
      ).status,
    ).toBe(401)

    expect((await setUser(w.sam, w.bob, { disabled: false })).body.disabled_at).toBeNull()
    expect((await w.bob.get('/decks')).status).toBe(200)
    expect((await login('bob@example.com')).status).toBe(200)
  })

  it('sai mật khẩu ở tài khoản bị khoá vẫn chỉ báo "sai email hoặc mật khẩu" (không lộ tài khoản nào bị khoá)', async () => {
    await setUser(w.sam, w.bob, { disabled: true })
    const res = await request(app).post('/auth/login').send({ email: 'bob@example.com', password: 'saimatkhau' })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('invalid_credentials')
  })

  it('khoá tài khoản không xoá dữ liệu, và đổi vai trò không vô tình mở khoá', async () => {
    await setUser(w.sam, w.bob, { disabled: true })
    expect((await setUser(w.sam, w.bob, { role: 'admin' })).body.disabled_at).toBeTruthy()
    const { rows } = await pool.query('select count(*)::int as n from words where user_id = $1', [w.bob.id])
    expect(rows[0].n).toBe(3)
  })
})

describe('DELETE /admin/users/:id', () => {
  it('xoá tài khoản người khác: dữ liệu cá nhân mất, nội dung nhóm được giữ, nhóm vẫn có trưởng nhóm', async () => {
    expect((await w.sam.del(`/admin/users/${w.alice.id}`)).status).toBe(204)
    expect((await login('alice@example.com')).status).toBe(401)
    const group = (await w.bob.get('/groups')).body.find((g) => g.id === w.groupId)
    expect(group.my_role).toBe('admin')
    const words = (await w.bob.get('/words')).body.map((x) => x.word)
    expect(words).toContain('group-by-alice')
    expect(words).not.toContain('apple')
  })
})

describe('Super admin duy nhất', () => {
  it('không tự xoá tài khoản được; có super admin khác thì được', async () => {
    const blocked = await w.sam.del('/auth/account', { password: PASSWORD })
    expect(blocked.status).toBe(403)
    const sue = await createUser(app, 'sue@example.com')
    await makeSuperAdmin(pool, sue)
    expect((await w.sam.del('/auth/account', { password: PASSWORD })).status).toBe(204)
  })
})

describe('GET /admin/overview — số liệu tổng quan toàn hệ thống', () => {
  const TZ = 'Asia/Ho_Chi_Minh'
  // Mốc 0h hôm nay theo múi giờ báo cáo, lệch đi `offset` (cú pháp interval của Postgres).
  const addReview = (user, offset) =>
    pool.query(
      `insert into review_log (user_id, quality, reviewed_at)
       values ($1, 4, (date_trunc('day', now() at time zone $2) at time zone $2) + $3::interval)`,
      [user.id, TZ, offset],
    )

  it('chỉ super admin xem được: admin và người dùng thường nhận 403, chưa đăng nhập nhận 401', async () => {
    await makeAdmin(pool, w.carol)
    for (const who of [w.carol, w.alice, w.bob]) {
      expect((await who.get('/admin/overview')).status).toBe(403)
    }
    expect((await request(app).get('/admin/overview')).status).toBe(401)
    expect((await w.sam.get('/admin/overview')).status).toBe(200)
  })

  it('tổng số khớp dữ liệu thật, và chỉ là con số gộp (không lộ email hay nội dung của ai)', async () => {
    await makeAdmin(pool, w.carol)
    await setUser(w.sam, w.bob, { disabled: true })
    const res = await w.sam.get('/admin/overview')
    const count = async (sql) => (await pool.query(`select count(*)::int as n from ${sql}`)).rows[0].n
    expect(res.body.totals).toEqual({
      users: 4,
      admins: 2, // carol (admin) + sam (super admin)
      disabled_users: 1,
      groups: 1,
      decks: await count('decks'),
      words: await count('words'),
      phrases: await count('phrases'),
    })
    expect(res.body.new_users).toEqual({ last_7_days: 4, last_30_days: 4 })
    expect(res.body.time_zone).toBe(TZ)
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com|apple/)
  })

  it('chuỗi theo ngày: đủ số ngày, ngày trống là 0, đếm đúng lượt ôn và số người học khác nhau', async () => {
    await addReview(w.bob, '1 minute')
    await addReview(w.bob, '2 minutes')
    await addReview(w.alice, '1 minute')
    await addReview(w.alice, '-3 days 1 hour')
    await addReview(w.carol, '-40 days') // ngoài cửa sổ 30 ngày

    const { body } = await w.sam.get('/admin/overview')
    expect(body.daily).toHaveLength(30)
    const dates = body.daily.map((d) => d.date)
    expect(dates).toEqual(dates.toSorted())
    expect(new Set(dates).size).toBe(30)

    const today = body.daily.at(-1)
    expect(today).toMatchObject({ reviews: 3, active_users: 2, new_users: 4 })
    expect(body.daily.at(-4)).toMatchObject({ reviews: 1, active_users: 1, new_users: 0 })
    expect(body.daily.at(-2)).toMatchObject({ reviews: 0, active_users: 0, new_users: 0 })
    expect(body.daily.reduce((sum, d) => sum + d.reviews, 0)).toBe(4)

    expect(body.active_users).toEqual({ today: 2, last_7_days: 2, last_30_days: 2 })
    expect(body.reviews).toEqual({ today: 3, last_7_days: 4 })
  })

  it('ranh giới ngày tính theo múi giờ báo cáo, không theo UTC', async () => {
    await addReview(w.bob, '-1 minute') // 23:59 hôm qua (giờ VN)
    const { body } = await w.sam.get('/admin/overview?days=7')
    expect(body.daily).toHaveLength(7)
    expect(body.daily.at(-1).reviews).toBe(0)
    expect(body.daily.at(-2)).toMatchObject({ reviews: 1, active_users: 1 })
    expect(body.active_users).toEqual({ today: 0, last_7_days: 1, last_30_days: 1 })
  })

  it('days ngoài khoảng 7–90 hoặc không phải số → 400', async () => {
    for (const days of ['3', '91', 'abc', '7.5']) {
      expect((await w.sam.get(`/admin/overview?days=${days}`)).status).toBe(400)
    }
    expect((await w.sam.get('/admin/overview?days=90')).body.daily).toHaveLength(90)
  })
})
