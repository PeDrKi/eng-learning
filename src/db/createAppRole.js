import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import pg from 'pg'

// Tạo (hoặc đặt lại mật khẩu cho) tài khoản database RIÊNG cho app — chỉ đọc/ghi dữ liệu.
//
// Vì sao: chuỗi kết nối mặc định của Neon là role CHỦ database (tạo/xoá bảng, đổi quyền...). App
// chạy bằng role đó thì một lỗ hổng SQL injection hay lộ chuỗi kết nối là mất cả database. Tách ra:
//   • DATABASE_URL        = role app (bên dưới): chỉ SELECT/INSERT/UPDATE/DELETE trên bảng có sẵn.
//   • DATABASE_URL_DIRECT = role chủ: chỉ dùng cho migration (release_command), không nằm trong app.
//
// `alter default privileges`: bảng do role chủ tạo ở các migration SAU NÀY cũng tự cấp quyền cho
// role app — không phải chạy lại script này mỗi khi thêm bảng.
//
// Chạy: DATABASE_URL_DIRECT=<chuỗi role chủ> node src/db/createAppRole.js
// In ra stdout đúng 1 dòng `APP_DATABASE_URL=...` (deploy/tach-quyen-db.ps1 đọc dòng này).

export const APP_ROLE = 'tuvung_app'

export async function createAppRole(
  ownerUrl,
  { role = APP_ROLE, password = randomBytes(32).toString('base64url') } = {},
) {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Tên role không hợp lệ: ${role}`)
  const client = new pg.Client({ connectionString: ownerUrl })
  await client.connect()
  try {
    const { rows } = await client.query(
      'select current_user as owner, current_database() as db, exists (select 1 from pg_roles where rolname = $1) as has_role',
      [role],
    )
    const { owner, db, has_role: hasRole } = rows[0]
    if (owner === role) throw new Error('Chuỗi kết nối đang là role app, cần chuỗi của role CHỦ database.')
    // Tên role/database/mật khẩu không truyền được qua $1 trong lệnh DDL → dùng format() của Postgres
    // để trích dẫn an toàn (%I = tên định danh, %L = chuỗi).
    const ddl = async (template, ...args) => {
      const { rows: r } = await client.query(
        `select format($1, ${args.map((_, i) => `$${i + 2}::text`).join(', ')}) as sql`,
        [template, ...args],
      )
      await client.query(r[0].sql)
    }
    await client.query('begin')
    // Role mới mặc định đã là nosuperuser/nocreatedb/nocreaterole; role đã có thì chỉ đổi mật khẩu
    // (role không phải superuser như trên Neon không được đụng tới các thuộc tính đó).
    if (hasRole) await ddl('alter role %I with password %L', role, password)
    else await ddl('create role %I with login nocreatedb nocreaterole password %L', role, password)
    await ddl('grant connect on database %I to %I', db, role)
    await ddl('grant usage on schema public to %I', role)
    await ddl('revoke create on schema public from %I', role)
    await ddl('grant select, insert, update, delete on all tables in schema public to %I', role)
    await ddl('grant usage, select on all sequences in schema public to %I', role)
    await ddl(
      'alter default privileges for role %I in schema public grant select, insert, update, delete on tables to %I',
      owner,
      role,
    )
    await ddl(
      'alter default privileges for role %I in schema public grant usage, select on sequences to %I',
      owner,
      role,
    )
    // Sổ ghi migration chỉ role chủ được đụng tới.
    const { rows: mig } = await client.query("select to_regclass('public.schema_migrations') is not null as ok")
    if (mig[0].ok) await ddl('revoke insert, update, delete on schema_migrations from %I', role)
    await client.query('commit')
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
  const url = new URL(ownerUrl)
  url.username = role
  url.password = password
  return url.toString()
}

// Kiểm tra role app làm được việc của app nhưng KHÔNG tạo/xoá bảng được.
export async function verifyAppRole(appUrl) {
  const client = new pg.Client({ connectionString: appUrl })
  await client.connect()
  try {
    await client.query('select count(*) from users')
    let canCreate = true
    try {
      await client.query('create table tuvung_quyen_thu (id int)')
      await client.query('drop table tuvung_quyen_thu')
    } catch {
      canCreate = false
    }
    if (canCreate) throw new Error('Role app vẫn tạo được bảng — quyền chưa được siết.')
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('dotenv/config')
  const ownerUrl = process.env.DATABASE_URL_DIRECT
  if (!ownerUrl) {
    console.error('Thiếu DATABASE_URL_DIRECT (chuỗi kết nối của role chủ database).')
    process.exit(1)
  }
  try {
    const appUrl = await createAppRole(ownerUrl)
    await verifyAppRole(appUrl)
    console.error(`[db] Đã tạo role "${APP_ROLE}": đọc/ghi dữ liệu được, không tạo/xoá bảng được.`)
    console.log(`APP_DATABASE_URL=${appUrl}`)
  } catch (err) {
    console.error(`[db] Lỗi: ${err.message}`)
    process.exit(1)
  }
}
