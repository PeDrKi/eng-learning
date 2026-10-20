import pg from 'pg'

// Postgres trả `timestamptz` về dạng Date của JS; khi trả JSON sẽ thành chuỗi ISO — đúng
// định dạng FE đang nhận từ Supabase.

export function createPool(databaseUrl, { max = 10 } = {}) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max, // mỗi instance; xem DB_POOL_MAX ở config.js
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
  // Lỗi trên 1 kết nối đang rảnh (VD: DB khởi động lại) — ghi log thay vì làm sập process.
  pool.on('error', (err) => console.error('[db] Lỗi kết nối rảnh:', err.message))
  return pool
}

// Chạy `fn(client)` trong 1 transaction: tự COMMIT nếu thành công, ROLLBACK nếu có lỗi.
export async function withTransaction(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
