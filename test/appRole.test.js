import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { createAppRole, verifyAppRole } from '../src/db/createAppRole.js'
import { setupTestApp } from './helpers.js'
import { TEST_DATABASE_URL } from './testDb.js'

// Role là của cả cụm Postgres (không riêng 1 database) → dùng tên riêng cho test và xoá khi xong.
const ROLE = 'tuvung_app_test'
setupTestApp() // đảm bảo DB test đã migrate đủ bảng

afterAll(async () => {
  const c = new pg.Client({ connectionString: TEST_DATABASE_URL })
  await c.connect()
  // Muốn xoá quyền đã cấp cho role (kể cả default privileges) phải có quyền của role đó trước.
  await c.query(`grant ${ROLE} to current_user`)
  await c.query(`drop owned by ${ROLE}`)
  await c.query(`drop role ${ROLE}`)
  await c.end()
})

describe('createAppRole — tài khoản DB riêng cho app', () => {
  it('role app đọc/ghi dữ liệu được nhưng KHÔNG tạo/xoá bảng, không sửa sổ migration', async () => {
    const appUrl = await createAppRole(TEST_DATABASE_URL, { role: ROLE })
    expect(new URL(appUrl).username).toBe(ROLE)
    await expect(verifyAppRole(appUrl)).resolves.toBeUndefined()

    const app = new pg.Client({ connectionString: appUrl })
    await app.connect()
    try {
      const { rows } = await app.query(
        "insert into users (email, password_hash) values ('role@example.com', 'x') returning id",
      )
      await app.query('update users set display_name = $2 where id = $1', [rows[0].id, 'Role'])
      await app.query('delete from users where id = $1', [rows[0].id])
      await expect(app.query('drop table words')).rejects.toThrow(/must be owner|permission denied/)
      await expect(app.query("delete from schema_migrations where name = 'x'")).rejects.toThrow(/permission denied/)
    } finally {
      await app.end()
    }
  })

  it('chạy lại: đặt mật khẩu mới, mật khẩu cũ hết dùng được', async () => {
    const first = await createAppRole(TEST_DATABASE_URL, { role: ROLE })
    const second = await createAppRole(TEST_DATABASE_URL, { role: ROLE })
    await expect(verifyAppRole(second)).resolves.toBeUndefined()
    await expect(verifyAppRole(first)).rejects.toThrow(/password authentication failed/)
  })

  it('bảng tạo ở migration sau này cũng tự cấp quyền cho role app', async () => {
    const appUrl = await createAppRole(TEST_DATABASE_URL, { role: ROLE })
    const owner = new pg.Client({ connectionString: TEST_DATABASE_URL })
    await owner.connect()
    await owner.query('create table if not exists tuvung_bang_moi (id int)')
    const app = new pg.Client({ connectionString: appUrl })
    await app.connect()
    try {
      await app.query('insert into tuvung_bang_moi values (1)')
      expect((await app.query('select count(*)::int as n from tuvung_bang_moi')).rows[0].n).toBe(1)
    } finally {
      await app.end()
      await owner.query('drop table tuvung_bang_moi')
      await owner.end()
    }
  })
})
