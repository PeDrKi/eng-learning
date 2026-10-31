import { readFileSync } from 'node:fs'
import { beforeEach, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

// Câu UPDATE chia lại loại cũ `dependent_prep` trong migration 028 — chạy lại trên dữ liệu giả lập
// (trong transaction, rollback ở cuối) để kiểm từng nhánh phân loại.
const migration = readFileSync(new URL('../migrations/028_collocation_categories.sql', import.meta.url), 'utf8')
const reclassify = migration.match(/update phrases set kind = case[\s\S]*?where kind = 'dependent_prep';/)[0]

it('migration 028: dependent_prep → động từ / tính từ / danh từ + giới từ, giữ nguyên tiến trình học', async () => {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('alter table phrases drop constraint phrases_kind_check')
    const add = async (headword, pattern) => {
      const { rows } = await client.query(
        `insert into phrases (user_id, kind, headword, phrase, answer, meaning)
         values ($1, 'dependent_prep', $2, $3, 'x', 'nghĩa') returning id`,
        [w.bob.id, headword, pattern],
      )
      return rows[0].id
    }
    const ids = {
      rely: await add('rely', 'rely on sb/sth'), // động từ trong bộ có sẵn
      interested: await add('interested', 'be interested in sth'), // tính từ trong bộ có sẵn
      reason: await add('reason', 'a reason for sth'), // danh từ trong bộ có sẵn
      bored: await add('bored', 'be bored with sth'), // không có trong bộ — đoán theo "be "
      cure: await add('cure', 'a cure for sth'), // không có trong bộ — đoán theo "a "
      apologize: await add('apologize', 'apologize for sth'), // không có trong bộ → động từ
    }
    await client.query('update phrase_progress set repetitions = 5 where phrase_id = $1', [ids.rely])
    await client.query(reclassify)
    const { rows } = await client.query('select id, kind from phrases where id = any($1::uuid[])', [Object.values(ids)])
    const kindOf = Object.fromEntries(rows.map((r) => [r.id, r.kind]))
    expect(kindOf[ids.rely]).toBe('prepositional_verb')
    expect(kindOf[ids.interested]).toBe('adjective_prep')
    expect(kindOf[ids.reason]).toBe('noun_prep')
    expect(kindOf[ids.bored]).toBe('adjective_prep')
    expect(kindOf[ids.cure]).toBe('noun_prep')
    expect(kindOf[ids.apologize]).toBe('prepositional_verb')
    const { rows: p } = await client.query('select repetitions from phrase_progress where phrase_id = $1', [ids.rely])
    expect(p[0].repetitions).toBe(5)
  } finally {
    await client.query('rollback')
    client.release()
  }
})

it('API nhận đủ 6 loại; từ chối loại cũ dependent_prep và loại đã bỏ verb_pattern', async () => {
  const base = { headword: 'x', pattern: 'x y', answer: 'y', meaning: 'nghĩa' }
  for (const kind of [
    'phrasal_verb',
    'prepositional_verb',
    'phrasal_prepositional_verb',
    'adjective_prep',
    'noun_prep',
    'verb_noun',
  ]) {
    expect((await w.bob.post('/collocations', { ...base, kind, pattern: `${kind} y` })).status).toBe(201)
  }
  expect((await w.bob.post('/collocations', { ...base, kind: 'dependent_prep' })).status).toBe(400)
  expect((await w.bob.post('/collocations', { ...base, kind: 'verb_pattern' })).status).toBe(400)
})

it('"Mẫu động từ" cũ còn trong DB: không bị xoá nhưng bị ẩn — không liệt kê, không sửa/xoá/ôn được', async () => {
  const { rows } = await pool.query(
    `insert into phrases (user_id, kind, headword, phrase, answer, meaning)
     values ($1, 'verb_pattern', 'prevent', 'prevent sb from V-ing', 'sb from V-ing', 'ngăn') returning id`,
    [w.bob.id],
  )
  const id = rows[0].id
  const visible = (
    await w.bob.post('/collocations', {
      headword: 'give',
      pattern: 'give up',
      answer: 'up',
      meaning: 'từ bỏ',
      kind: 'phrasal_verb',
    })
  ).body
  expect((await w.bob.get('/collocations')).body.map((c) => c.id)).toEqual([visible.id])
  expect((await w.bob.patch(`/collocations/${id}`, { meaning: 'x' })).status).toBe(404)
  expect((await w.bob.del(`/collocations/${id}`)).status).toBe(404)
  expect((await w.bob.patch(`/collocations/${visible.id}`, { kind: 'verb_pattern' })).status).toBe(400)
  expect((await pool.query('select count(*)::int as n from phrases where id = $1', [id])).rows[0].n).toBe(1)
})
