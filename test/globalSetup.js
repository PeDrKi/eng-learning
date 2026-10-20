import pg from 'pg'
import { migrate } from '../src/db/migrate.js'
import { TEST_DATABASE_URL } from './testDb.js'

// Chạy 1 lần trước toàn bộ test: dựng lại schema từ đầu bằng chính các file migration →
// test luôn kiểm tra đúng schema sẽ chạy trên production.
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL })
  await client.connect()
  await client.query('drop schema public cascade; create schema public;')
  await client.end()
  await migrate(TEST_DATABASE_URL, { log: () => {} })
}
