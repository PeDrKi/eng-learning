import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { hashPassword } from '../lib/password.js'
import { ACCOUNTS, DECKS, DEMO_DOMAIN, DEMO_PASSWORD, GROUPS, PHRASES, PROFILES, WORDS } from './seedData.js'

// ============================================================
// Đổ dữ liệu mẫu vào database — `npm run seed`.
//
// Dùng để: xem app với dữ liệu thật sau khi cài mới, thử các vai trò (user / admin / super admin /
// tài khoản bị khoá), thử nhóm học, và có sẵn thẻ đến hạn để mở màn Học là học được ngay.
//
// HAI NGUYÊN TẮC AN TOÀN, vì script này GHI vào database:
//
//   1. Chỉ chạy trên database ở MÁY MÌNH. Dữ liệu mẫu lẫn vào dữ liệu người dùng thật thì không
//      gỡ ra được bằng cách nào gọn gàng. Muốn chạy ở nơi khác phải tự đặt biến môi trường
//      SEED_ALLOW_REMOTE=toi-chac-chan — gõ được câu đó nghĩa là đã đọc tới dòng này.
//
//   2. Chỉ đụng tới các tài khoản `@tuvung.test`. Mỗi lần chạy, script XOÁ rồi tạo lại đúng
//      những tài khoản đó (khoá ngoại on delete cascade dọn sạch dữ liệu con). Tài khoản thật
//      không bị động tới một dòng nào. Nhờ vậy chạy lại bao nhiêu lần cũng cho cùng kết quả.
//
// Biến môi trường:
//   DATABASE_URL        bắt buộc
//   N_WORDS=2000        số từ của tài khoản "người học nặng"
//   SEED_ALLOW_REMOTE   đặt = toi-chac-chan để chạy trên database không phải localhost
// ============================================================

const DAY = 24 * 60 * 60 * 1000

// Ngẫu nhiên nhưng LẶP LẠI ĐƯỢC: chạy hai lần cho ra cùng bộ dữ liệu, nên khi so sánh "hôm qua
// thấy thế này, hôm nay thấy thế kia" thì khác biệt là do code, không phải do bốc thăm lại.
function makeRandom(hatGiong = 20261005) {
  let s = hatGiong
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

export function isLocalDatabase(url) {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === ''
  } catch {
    return false
  }
}

export function assertSafeTarget(url, allowRemote) {
  if (isLocalDatabase(url)) return
  if (allowRemote === 'toi-chac-chan') return
  throw new Error(
    'DATABASE_URL không trỏ tới máy mình.\n' +
      'Script này ghi dữ liệu mẫu vào database, nên mặc định chỉ chạy với localhost/127.0.0.1.\n' +
      'Nếu thật sự muốn chạy ở đây, đặt SEED_ALLOW_REMOTE=toi-chac-chan rồi chạy lại.',
  )
}

// Chia N từ cho các chủ đề theo vòng tròn, và lặp lại danh sách từ gốc khi cần nhiều hơn số từ
// có sẵn. Từ lặp được thêm hậu tố để không trùng tên — app chặn thêm trùng từ, dữ liệu mẫu cũng
// không nên tự mâu thuẫn với luật đó. Chỉ tài khoản đo tải (`nang`) cần tới việc lặp này; các tài
// khoản để xem thử app giữ trong số từ gốc (xem PROFILES).
function buildWords(count) {
  const out = []
  for (let i = 0; i < count; i += 1) {
    const [word, meaning, ipa, example, tags] = WORDS[i % WORDS.length]
    const round = Math.floor(i / WORDS.length)
    out.push({
      word: round === 0 ? word : `${word} (${round + 1})`,
      meaning,
      ipa,
      example,
      tags,
    })
  }
  return out
}

// Trạng thái học của một thẻ. Trộn đủ các giai đoạn vì mỗi màn hình chỉ sống dậy với một loại:
// màn Học cần thẻ ĐẾN HẠN, Thống kê cần thẻ đã thuộc lâu, lời nhắc "từ khó nhớ" cần lapses cao.
function progressFor(i, rnd) {
  const r = rnd()
  if (r < 0.15) return { kind: 'moi', reps: 0, ease: 2.5, interval: 0, dueIn: 0, lapses: 0 }
  if (r < 0.4)
    return {
      kind: 'den-han',
      reps: 2 + Math.floor(rnd() * 3),
      ease: 2.3,
      interval: 3,
      dueIn: -Math.floor(rnd() * 4),
      lapses: Math.floor(rnd() * 2),
    }
  if (r < 0.85) {
    const interval = 7 + Math.floor(rnd() * 60)
    return {
      kind: 'da-thuoc',
      reps: 5 + Math.floor(rnd() * 8),
      ease: 2.5 + rnd() * 0.4,
      interval,
      dueIn: Math.ceil(rnd() * interval),
      lapses: Math.floor(rnd() * 3),
    }
  }
  // "Từ mãi không thuộc": lapses ≥ 6 là ngưỡng LEECH_THRESHOLD ở frontend (src/lib/leech.js).
  return {
    kind: 'kho-nho',
    reps: 1,
    ease: 1.7,
    interval: 1,
    dueIn: -Math.floor(rnd() * 6),
    lapses: 6 + Math.floor(rnd() * 7),
  }
}

// Chèn nhiều dòng trong MỘT câu lệnh. Với tài khoản 2000 từ, chèn từng dòng một mất hàng chục
// giây vì mỗi dòng là một vòng đi-về tới database.
async function insertMany(db, table, columns, rows, { returning = '', chunk = 500 } = {}) {
  const out = []
  for (let start = 0; start < rows.length; start += chunk) {
    const slice = rows.slice(start, start + chunk)
    const params = []
    const tuples = slice.map((row) => {
      const holes = row.map((value) => {
        params.push(value)
        return `$${params.length}`
      })
      return `(${holes.join(', ')})`
    })
    const sql = `insert into ${table} (${columns.join(', ')}) values ${tuples.join(', ')} ${returning}`
    const { rows: got } = await db.query(sql, params)
    out.push(...got)
  }
  return out
}

async function seedLearner(db, { userId, profile, rnd, nWords }) {
  const spec = { ...PROFILES[profile], ...(nWords ? { words: nWords } : {}) }
  if (!spec.words) return { words: 0, phrases: 0, reviews: 0 }

  const deckRows = DECKS.slice(0, spec.decks).map((d) => [userId, d.name, d.color])
  const decks = await insertMany(db, 'decks', ['user_id', 'name', 'color'], deckRows, { returning: 'returning id' })

  const words = buildWords(spec.words)
  // Trigger on_word_created tự tạo dòng word_progress cho mỗi từ → bên dưới chỉ cần UPDATE.
  const inserted = await insertMany(
    db,
    'words',
    ['user_id', 'deck_id', 'word', 'meaning', 'example', 'ipa', 'tags'],
    words.map((w, i) => [
      userId,
      decks.length ? decks[i % decks.length].id : null,
      w.word,
      w.meaning,
      w.example,
      w.ipa,
      w.tags,
    ]),
    { returning: 'returning id' },
  )

  const now = Date.now()
  const progress = []
  for (let i = 0; i < inserted.length; i += 1) {
    const p = progressFor(i, rnd)
    const due = new Date(now + p.dueIn * DAY)
    const last = p.reps > 0 ? new Date(now - (p.interval || 1) * DAY) : null
    progress.push([
      inserted[i].id,
      p.ease,
      p.interval,
      p.reps,
      due,
      last,
      p.lapses,
      Math.floor(rnd() * 12),
      Math.floor(rnd() * 5),
      p.kind,
    ])
  }
  // Chiều "sản sinh" (Việt→Anh) đi chậm hơn chiều "nhận diện" — đúng như người học thật: nhận ra
  // mặt chữ bao giờ cũng dễ hơn tự nhớ ra từ.
  for (const row of progress) {
    await db.query(
      `update word_progress set
         ease_factor = $2::real, interval_days = $3::real, repetitions = $4::int,
         due_at = $5::timestamptz, last_reviewed_at = $6::timestamptz,
         lapses = $7::int, quiz_correct = $8::int, quiz_wrong = $9::int,
         ease_factor_rev = $2::real, interval_days_rev = $3::real / 2,
         repetitions_rev = greatest($4::int - 2, 0),
         due_at_rev = $5::timestamptz - interval '1 day', last_reviewed_at_rev = $6::timestamptz
       where word_id = $1`,
      row.slice(0, 9),
    )
  }

  // Gắn nhãn "khó nhớ" đúng những từ chạm ngưỡng — giống hệt việc app tự làm khi quên lần thứ 6.
  // Lọc theo user_id: script chỉ được đụng tới tài khoản nó đang tạo. Một câu UPDATE không có
  // điều kiện user ở đây sẽ sửa nhãn trên từ của MỌI tài khoản trong database.
  await db.query(
    `update words set tags = array_append(tags, 'khó nhớ')
       from word_progress wp
      where wp.word_id = words.id and words.user_id = $1
        and wp.lapses >= 6 and not ('khó nhớ' = any(words.tags))`,
    [userId],
  )

  // Câu giao tiếp (trigger phrases_after_insert tự tạo phrase_progress).
  const phraseRows = PHRASES.slice(0, spec.phrases).map(([phrase, meaning, context, example, formality], i) => [
    userId,
    decks.length ? decks[i % decks.length].id : null,
    phrase,
    meaning,
    context,
    example,
    formality,
  ])
  const phrases = await insertMany(
    db,
    'phrases',
    ['user_id', 'deck_id', 'phrase', 'meaning', 'usage_context', 'example', 'formality'],
    phraseRows,
    { returning: 'returning id' },
  )
  for (const p of phrases) {
    await db.query(
      `update phrase_progress set repetitions = $2, interval_days = $3, due_at = now() - make_interval(days => $4)
        where phrase_id = $1`,
      [p.id, 1 + Math.floor(rnd() * 4), 1 + Math.floor(rnd() * 10), Math.floor(rnd() * 2)],
    )
  }

  // Nhật ký ôn: để Thống kê có biểu đồ và CHUỖI NGÀY HỌC có ý nghĩa.
  //
  // Hôm nay luôn có lượt ôn, và vài ngày gần nhất liền mạch → chuỗi ngày hiện ra ngay. Xa hơn thì
  // thưa dần và có ngày nghỉ, vì một biểu đồ đều tăm tắp 90 ngày trông giả và che mất lỗi hiển thị
  // của những ngày trống.
  const log = []
  const streak = Math.min(spec.days, 5)
  for (let d = 0; d < spec.days; d += 1) {
    const nghi = d >= streak && rnd() < 0.3
    if (nghi) continue
    const n = d < streak ? 12 + Math.floor(rnd() * 25) : Math.floor(rnd() * 30)
    for (let k = 0; k < n; k += 1) {
      const w = inserted[Math.floor(rnd() * inserted.length)]
      // Rải trong khoảng 8h–20h của ngày đó, nhưng KHÔNG BAO GIỜ vượt quá bây giờ: một lượt ôn ở
      // tương lai làm sai số liệu "hôm nay" và vẽ ra cột biểu đồ chưa từng xảy ra.
      const day = new Date(now - d * DAY)
      day.setHours(8 + Math.floor(rnd() * 12), Math.floor(rnd() * 60), 0, 0)
      const at = new Date(Math.min(day.getTime(), now - 60 * 1000))
      log.push([
        userId,
        w.id,
        rnd() < 0.78 ? 3 + Math.floor(rnd() * 3) : Math.floor(rnd() * 3),
        rnd() < 0.6 ? 'recognition' : 'production',
        at,
      ])
    }
  }
  await insertMany(db, 'review_log', ['user_id', 'word_id', 'quality', 'direction', 'reviewed_at'], log)

  return { words: inserted.length, phrases: phrases.length, reviews: log.length }
}

export async function seed(db, { nWords = 2000, log = console.log } = {}) {
  const rnd = makeRandom()
  const emails = ACCOUNTS.map((a) => a.email)

  // Dọn lần chạy trước. Chỉ xoá đúng các email mẫu; cascade lo phần còn lại.
  const { rowCount: removed } = await db.query('delete from users where email = any($1)', [emails])
  // Nhóm do tài khoản mẫu tạo không bị cascade (created_by là `on delete set null`) → xoá theo mã mời.
  await db.query('delete from groups where invite_code = any($1)', [GROUPS.map((g) => g.invite_code)])
  if (removed) log(`[seed] đã xoá ${removed} tài khoản mẫu của lần chạy trước`)

  const passwordHash = await hashPassword(DEMO_PASSWORD)
  const ids = {}
  const summary = []

  for (const acc of ACCOUNTS) {
    const { rows } = await db.query(
      `insert into users (email, password_hash, role, disabled_at, email_verified_at)
       values ($1, $2, $3, $4, now()) returning id`,
      [acc.email, passwordHash, acc.role, acc.disabled ? new Date() : null],
    )
    ids[acc.key] = rows[0].id
    await db.query(
      `insert into user_settings (user_id, new_cards_per_day, session_size, daily_goal, reviews_per_day,
                                  reminder_enabled, reminder_hour, reminder_tz)
       values ($1, $2, $3, $4, $5, $6, $7, 'Asia/Ho_Chi_Minh')`,
      [ids[acc.key], 20, 10, 20, 100, acc.key === 'hoc', 20],
    )

    const counts = await seedLearner(db, {
      userId: ids[acc.key],
      profile: acc.profile,
      rnd,
      // Chỉ tài khoản "người học nặng" mới lấy số từ từ biến môi trường.
      nWords: acc.profile === 'nang' ? nWords : 0,
    })
    summary.push({ ...acc, ...counts })
    log(
      `[seed] ${acc.email.padEnd(24)} ${acc.role.padEnd(12)} ${counts.words} từ, ${counts.phrases} câu, ${counts.reviews} lượt ôn`,
    )
  }

  for (const g of GROUPS) {
    const { rows } = await db.query(
      'insert into groups (name, invite_code, created_by) values ($1, $2, $3) returning id',
      [g.name, g.invite_code, ids[g.admin]],
    )
    const groupId = rows[0].id
    await db.query('insert into group_members (group_id, user_id, role) values ($1, $2, $3)', [
      groupId,
      ids[g.admin],
      'admin',
    ])
    for (const key of g.members) {
      if (key === g.admin) continue
      await db.query('insert into group_members (group_id, user_id, role) values ($1, $2, $3)', [
        groupId,
        ids[key],
        'member',
      ])
    }
    // Một chủ đề dùng chung để nhóm có nội dung chứ không rỗng.
    await db.query('insert into decks (user_id, group_id, name, color) values ($1, $2, $3, $4)', [
      ids[g.admin],
      groupId,
      `${g.name} — từ chung`,
      '#C9A15E',
    ])
    log(`[seed] nhóm "${g.name}" (mã mời ${g.invite_code}) — ${g.members.length} thành viên`)
  }

  return summary
}

// Chạy trực tiếp: `npm run seed`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('Thiếu DATABASE_URL.')
    process.exit(1)
  }
  try {
    assertSafeTarget(url, process.env.SEED_ALLOW_REMOTE)
  } catch (err) {
    console.error(`\n${err.message}\n`)
    process.exit(1)
  }

  const nWords = Number(process.env.N_WORDS || 2000)
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  try {
    const started = Date.now()
    const summary = await seed(db, { nWords })
    console.log(
      `\n[seed] xong trong ${((Date.now() - started) / 1000).toFixed(1)}s. Mật khẩu chung: ${DEMO_PASSWORD}\n`,
    )
    for (const a of summary) console.log(`  ${a.email.padEnd(24)} ${a.label}`)
    console.log(`\n  (mọi tài khoản mẫu đều có đuôi ${DEMO_DOMAIN}; chạy lại script sẽ tạo mới sạch sẽ)\n`)
  } finally {
    await db.end()
  }
}
