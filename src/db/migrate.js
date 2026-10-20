import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'

// Bộ chạy migration tối giản: áp dụng lần lượt các file migrations/NNN_ten.sql chưa chạy,
// ghi lại vào bảng schema_migrations. Mỗi file chạy trong 1 transaction riêng (lỗi giữa chừng
// là huỷ sạch file đó). Advisory lock chặn 2 tiến trình chạy migration cùng lúc (VD: 2 lần
// deploy chồng nhau).
//
// Quy ước: KHÔNG BAO GIỜ sửa 1 file migration đã chạy trên production — muốn đổi schema thì
// thêm file mới với số thứ tự lớn hơn.

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations')
const LOCK_ID = 7_283_401

export async function migrate(databaseUrl, { log = console.log } = {}) {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID])
    await client.query(`create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`)
    const { rows } = await client.query('select name from schema_migrations')
    const applied = new Set(rows.map((r) => r.name))
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).toSorted()

    let count = 0
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query('insert into schema_migrations (name) values ($1)', [file])
        await client.query('commit')
      } catch (err) {
        await client.query('rollback')
        throw new Error(`Migration ${file} thất bại: ${err.message}`, { cause: err })
      }
      log(`[migrate] Đã áp dụng ${file}`)
      count++
    }
    if (count === 0) log('[migrate] Không có migration mới.')
    return count
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {})
    await client.end()
  }
}

// Chạy trực tiếp: `npm run migrate`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('dotenv/config')
  // Migration cần kết nối TRỰC TIẾP (advisory lock theo phiên) — ưu tiên DATABASE_URL_DIRECT khi
  // DATABASE_URL trỏ qua connection pooler.
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL
  if (!url) {
    console.error('Thiếu DATABASE_URL')
    process.exit(1)
  }
  try {
    await migrate(url)
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
