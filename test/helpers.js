import { afterAll, beforeEach } from 'vitest'
import { createApp } from '../src/app.js'
export { createApp }
import { loadConfig } from '../src/config.js'
import { createPool } from '../src/db/pool.js'
import { TEST_DATABASE_URL } from './testDb.js'

export const FE_ORIGIN = 'http://localhost:5173'

export function testConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123',
    CORS_ORIGINS: FE_ORIGIN,
    APP_URL: FE_ORIGIN,
    RATE_LIMIT_ENABLED: 'false',
    PASSWORD_RESET_MIN_RESPONSE_MS: '0', // test không cần chờ; có test riêng cho mức tối thiểu
    ...overrides,
  })
}

// Mỗi file test gọi 1 lần: có app, pool DB và mailer giả (ghi lại email thay vì gửi).
// Dữ liệu được xoá sạch trước MỖI test.
// `appOptions`: phụ thuộc thêm cho createApp (VD: rateLimitStore).
export function setupTestApp(configOverrides, appOptions = {}) {
  const config = testConfig(configOverrides)
  const pool = createPool(config.databaseUrl)
  const mailer = {
    sent: [],
    send(msg) {
      this.sent.push(msg)
    },
  }
  const app = createApp({ config, pool, mailer, ...appOptions })

  beforeEach(async () => {
    mailer.sent.length = 0
    await pool.query('truncate users, groups restart identity cascade')
  })
  afterAll(() => pool.end())

  return { app, pool, mailer, config }
}

// Lấy giá trị cookie refresh từ header Set-Cookie của response.
export function refreshCookieOf(res) {
  const raw = (res.headers['set-cookie'] || []).find((c) => c.startsWith('tv_refresh='))
  if (!raw) return undefined
  return raw.split(';')[0].slice('tv_refresh='.length)
}

// ---- Dựng dữ liệu cho test phân quyền ----

// Đăng ký 1 người dùng thật qua API, trả về id + hàm gọi API đã kèm token của người đó.
export async function createUser(app, email) {
  const { default: request } = await import('supertest')
  const res = await request(app).post('/auth/register').send({ email, password: 'matkhau123' })
  if (res.status !== 201) throw new Error(`Không tạo được ${email}: ${JSON.stringify(res.body)}`)
  const token = res.body.access_token
  const withAuth = (req) => req.set('Authorization', `Bearer ${token}`)
  return {
    id: res.body.user.id,
    email,
    get: (url) => withAuth(request(app).get(url)),
    post: (url, body) => withAuth(request(app).post(url)).send(body),
    patch: (url, body) => withAuth(request(app).patch(url)).send(body),
    put: (url, body) => withAuth(request(app).put(url)).send(body),
    del: (url, body) => withAuth(request(app).delete(url)).send(body),
  }
}

// Tạo nhóm thẳng bằng SQL (module Nhóm chưa có API).
export async function makeGroup(pool, { admin, members = [] }) {
  const { rows } = await pool.query(
    "insert into groups (name, invite_code, created_by) values ('Nhóm test', substr(md5(random()::text), 1, 8), $1) returning id",
    [admin.id],
  )
  const groupId = rows[0].id
  await pool.query("insert into group_members (group_id, user_id, role) values ($1, $2, 'admin')", [groupId, admin.id])
  for (const m of members) {
    await pool.query("insert into group_members (group_id, user_id, role) values ($1, $2, 'member')", [groupId, m.id])
  }
  return groupId
}

export const makeSuperAdmin = (pool, user) =>
  pool.query("update users set role = 'super_admin' where id = $1", [user.id])

// Admin toàn hệ thống: quản lý mọi nhóm như super admin, nhưng không quản lý tài khoản.
export const makeAdmin = (pool, user) => pool.query("update users set role = 'admin' where id = $1", [user.id])

// Thế giới mẫu: alice là trưởng nhóm, bob là thành viên, carol là người ngoài, sam là super
// admin (không thuộc nhóm nào). Mỗi người có chủ đề + từ riêng, nhóm có 1 chủ đề chung.
export async function buildWorld(app, pool) {
  const [alice, bob, carol, sam] = await Promise.all(
    ['alice', 'bob', 'carol', 'sam'].map((n) => createUser(app, `${n}@example.com`)),
  )
  await makeSuperAdmin(pool, sam)
  const groupId = await makeGroup(pool, { admin: alice, members: [bob] })

  const deck = async (user, name, group_id) => (await user.post('/decks', { name, group_id })).body
  const decks = {
    alice: await deck(alice, 'Alice riêng'),
    bob: await deck(bob, 'Bob riêng'),
    carol: await deck(carol, 'Carol riêng'),
    group: await deck(alice, 'Chủ đề nhóm', groupId),
  }
  const word = async (user, text, deck_id) =>
    (await user.post('/words', { word: text, meaning: 'nghĩa', deck_id })).body
  const words = {
    alicePersonal: await word(alice, 'apple', decks.alice.id),
    aliceInGroup: await word(alice, 'group-by-alice', decks.group.id),
    bobPersonal: await word(bob, 'banana', decks.bob.id),
    bobInGroup: await word(bob, 'group-by-bob', decks.group.id),
    bobUncategorized: await word(bob, 'loose', null),
    carolPersonal: await word(carol, 'cherry', decks.carol.id),
  }
  return { alice, bob, carol, sam, groupId, decks, words }
}
