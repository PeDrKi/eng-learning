import { withTransaction } from '../../db/pool.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/httpError.js'
import { assertWithinQuota } from '../../lib/quotas.js'
import { sqlPublicIdentity } from '../../lib/publicName.js'
import { createReadingCollectionsService } from '../readings/readingCollections.service.js'
import { assertCommunityAllowed } from './guard.js'

// Chia sẻ BÀI ĐỌC ra cộng đồng (migration 033, đợt 1): công khai cả BỘ bài đọc hoặc TỪNG bài lẻ, xem
// chỉ đọc, "Lưu vào thư viện" (đánh dấu để mở lại, luôn thấy bản mới nhất), "Sao chép" (bản riêng),
// nhận xét. Như chủ đề cộng đồng: chỉ người đã đăng nhập xem được, chỉ hiện tên công khai (không email).
//
// Ai xem được:
//   - bộ:  của mình, hoặc đang công khai và chưa bị gỡ.
//   - bài: của mình, hoặc chưa bị gỡ và (tự công khai, hoặc nằm trong một bộ đang công khai, chưa bị gỡ).
// Tắt công khai thì các lượt "lưu" bị xoá — người đã "Sao chép" vẫn giữ bản của họ.
// Người xem không bao giờ thấy `saved_to` của ghi chú (trỏ tới Sổ từ của chủ) và chỉ thấy bản dịch khi
// người chia sẻ cho phép (include_translations). NGUYÊN VĂN mặc định ẩn (include_content = false): người xem chỉ
// thấy ghi chú + bản dịch, không tìm kiếm được trong nguyên văn, sao chép cũng không nhận nguyên văn.

const notFoundCollection = () => notFound('Không tìm thấy bộ bài đọc công khai.')
const notFoundReading = () => notFound('Không tìm thấy bài đọc công khai.')

// $1 = người gọi. `c` = reading_collections.
const SQL_COLLECTION_VISIBLE = `(c.user_id = $1 or (c.is_public and c.hidden_at is null))`
// `r` = readings. Bài xem được nhờ chính nó công khai, hoặc nhờ bộ chứa nó đang công khai.
const SQL_PUBLIC_VIA_COLLECTION = `exists (select 1 from reading_collections pc
  where pc.id = r.collection_id and pc.is_public and pc.hidden_at is null)`
const SQL_READING_VISIBLE = `(r.user_id = $1 or (r.hidden_at is null and (r.is_public or ${SQL_PUBLIC_VIA_COLLECTION})))`

const cleanNotes = (notes) =>
  (Array.isArray(notes) ? notes : []).map(({ id, type, text, meaning = '', explanation = '', example = '' }) => ({
    id,
    type,
    text,
    meaning,
    explanation,
    example,
  }))

// Một bài theo góc nhìn người xem: bỏ id người dùng, saved_to; nguyên văn / bản dịch chỉ khi được phép.
function publicReading(r, { owner, showTranslations, showContent }) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    content: owner || showContent ? r.content : '',
    content_shared: owner || showContent,
    notes: owner ? r.notes : cleanNotes(r.notes),
    translations: owner || showTranslations ? r.translations : [],
    translations_shared: owner || showTranslations,
    collection_id: r.collection_id,
    position: r.position,
    is_public: r.is_public,
    hidden: r.hidden_at !== null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

/**
 * Báo cáo một nội dung bài đọc (dùng ở community.service.js → report): nội dung còn tồn tại và người báo
 * cáo XEM được nó thì trả true.
 */
export async function readingTargetVisible(db, userId, type, id) {
  if (type === 'reading_collection') {
    const { rowCount } = await db.query(
      `select 1 from reading_collections c where c.id = $2 and ${SQL_COLLECTION_VISIBLE}`,
      [userId, id],
    )
    return rowCount > 0
  }
  if (type === 'reading') {
    const { rowCount } = await db.query(`select 1 from readings r where r.id = $2 and ${SQL_READING_VISIBLE}`, [
      userId,
      id,
    ])
    return rowCount > 0
  }
  const { rows } = await db.query(
    'select collection_id, reading_id from reading_comments where id = $1 and deleted_at is null',
    [id],
  )
  const c = rows[0]
  if (!c) return false
  return c.reading_id
    ? readingTargetVisible(db, userId, 'reading', c.reading_id)
    : readingTargetVisible(db, userId, 'reading_collection', c.collection_id)
}

export function createReadingCommunityService({
  pool,
  quotas,
  requireVerifiedEmail = false,
  notify = async () => {},
  communityService = null, // để "chia sẻ cả chủ đề từ vựng đi kèm" dùng đúng luật công khai chủ đề
}) {
  const collections = createReadingCollectionsService({ pool, quotas })

  // ---------------- Bộ bài đọc ----------------
  const COLLECTION_COLUMNS = `c.id, c.name, c.description, c.is_public, c.published_at, c.include_translations,
       c.include_content,
       (c.hidden_at is not null) as hidden, c.deck_id, ${sqlPublicIdentity('owner')},
       (c.user_id = $1) as mine,
       exists (select 1 from reading_follows f where f.collection_id = c.id and f.user_id = $1) as followed,
       (select count(*)::int from reading_follows f where f.collection_id = c.id) as follower_count`

  async function findCollection(ctx, id) {
    const { rows } = await pool.query(
      `select ${COLLECTION_COLUMNS}, c.user_id
         from reading_collections c join users u on u.id = c.user_id
        where c.id = $2 and ${SQL_COLLECTION_VISIBLE}`,
      [ctx.userId, id],
    )
    return rows[0] ?? null
  }

  async function getCollection(ctx, id) {
    const c = await findCollection(ctx, id)
    if (!c) throw notFoundCollection()
    const { rows } = await pool.query(
      `select r.*,
              (select count(*)::int from reading_comments rc
                where rc.reading_id = r.id and rc.collection_id = $1 and rc.deleted_at is null) as comment_count
         from readings r
        where r.collection_id = $1 ${c.mine ? '' : 'and r.hidden_at is null'}
        order by r.position, r.created_at, r.id`,
      [id],
    )
    const { rows: counts } = await pool.query(
      'select count(*)::int as n from reading_comments where collection_id = $1 and reading_id is null and deleted_at is null',
      [id],
    )
    const { user_id, ...rest } = c
    void user_id
    return {
      ...rest,
      comment_count: counts[0].n,
      readings: rows.map((r) => ({
        ...publicReading(r, {
          owner: c.mine,
          showTranslations: c.include_translations,
          showContent: c.include_content,
        }),
        comment_count: r.comment_count,
      })),
    }
  }

  // ---------------- Bài đọc ----------------
  async function findReading(ctx, id) {
    const { rows } = await pool.query(
      `select r.*, ${sqlPublicIdentity('owner')}, (r.user_id = $1) as mine,
              exists (select 1 from reading_follows f where f.reading_id = r.id and f.user_id = $1) as followed,
              (select count(*)::int from reading_follows f where f.reading_id = r.id) as follower_count,
              c.name as collection_name, c.include_translations as collection_translations,
              c.include_content as collection_content,
              (c.is_public and c.hidden_at is null) as collection_public
         from readings r join users u on u.id = r.user_id
         left join reading_collections c on c.id = r.collection_id
        where r.id = $2 and ${SQL_READING_VISIBLE}`,
      [ctx.userId, id],
    )
    return rows[0] ?? null
  }

  async function getReading(ctx, id) {
    const r = await findReading(ctx, id)
    if (!r) throw notFoundReading()
    // Bản dịch: bài tự công khai theo lựa chọn của chính nó; xem qua bộ thì theo lựa chọn của bộ.
    const showTranslations =
      (r.is_public && r.include_translations) || (r.collection_public && r.collection_translations)
    const showContent = (r.is_public && r.include_content) || (r.collection_public && r.collection_content)
    const { rows: counts } = await pool.query(
      'select count(*)::int as n from reading_comments where reading_id = $1 and collection_id is null and deleted_at is null',
      [id],
    )
    return {
      ...publicReading(r, { owner: r.mine, showTranslations, showContent }),
      include_translations: r.include_translations,
      include_content: r.include_content,
      published_at: r.published_at,
      owner_name: r.owner_name,
      owner_tag: r.owner_tag,
      mine: r.mine,
      followed: r.followed,
      follower_count: r.follower_count,
      // Bài nằm trong một bộ đang công khai → giao diện mở được cả bộ.
      collection: r.collection_public ? { id: r.collection_id, name: r.collection_name } : null,
      comment_count: counts[0].n,
    }
  }

  // ---------------- Khám phá ----------------
  // Bộ và bài lẻ đang công khai (chưa bị gỡ). `saved` = chỉ những gì mình đã lưu.
  async function listPublic({ userId }, { q, saved = false } = {}) {
    const pattern = q ? `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null
    const { rows } = await pool.query(
      `select * from (
         select 'collection' as type, c.id, c.name as title, c.description, null::text as kind,
                c.published_at, ${sqlPublicIdentity('owner')}, null::text as group_name, (c.user_id = $1) as mine,
                exists (select 1 from reading_follows f where f.collection_id = c.id and f.user_id = $1) as followed,
                (select count(*)::int from reading_follows f where f.collection_id = c.id) as follower_count,
                (select count(*)::int from readings r where r.collection_id = c.id and r.hidden_at is null) as reading_count,
                (select coalesce(sum(jsonb_array_length(r.notes)), 0)::int from readings r
                  where r.collection_id = c.id and r.hidden_at is null) as note_count
           from reading_collections c join users u on u.id = c.user_id
          where c.is_public and c.hidden_at is null
            and ($2::text is null or c.name ilike $2 or c.description ilike $2 or u.display_name ilike $2)
         union all
         select 'reading', r.id, r.title, case when r.include_content then left(r.content, 200) else '' end, r.kind,
                r.published_at, ${sqlPublicIdentity('owner')}, null, (r.user_id = $1),
                exists (select 1 from reading_follows f where f.reading_id = r.id and f.user_id = $1),
                (select count(*)::int from reading_follows f where f.reading_id = r.id),
                1, jsonb_array_length(r.notes)
           from readings r join users u on u.id = r.user_id
          where r.is_public and r.hidden_at is null
            and ($2::text is null or r.title ilike $2 or (r.include_content and r.content ilike $2)
                 or u.display_name ilike $2)
       ) x
       where (not $3 or x.followed)
       order by x.follower_count desc, x.published_at desc, x.id
       limit 100`,
      [userId, pattern, saved],
    )
    return rows
  }

  // ---------------- Bật / tắt công khai (chỉ chủ sở hữu) ----------------
  async function ownCollection(ctx, id) {
    const { rows } = await pool.query('select * from reading_collections where id = $1 and user_id = $2', [
      id,
      ctx.userId,
    ])
    if (!rows[0]) throw notFound('Không tìm thấy bộ bài đọc.')
    return rows[0]
  }
  async function ownReading(ctx, id) {
    const { rows } = await pool.query('select * from readings where id = $1 and user_id = $2', [id, ctx.userId])
    if (!rows[0]) throw notFound('Không tìm thấy bài đọc.')
    return rows[0]
  }

  async function publishCollection(ctx, id, { description, include_translations, include_content, publish_deck }) {
    const c = await ownCollection(ctx, id)
    await assertCommunityAllowed(pool, ctx.userId)
    if (c.hidden_at) throw conflict('collection_hidden', 'Bộ này đã bị quản trị viên gỡ khỏi cộng đồng.')
    await pool.query(
      `update reading_collections
          set is_public = true, published_at = coalesce(published_at, now()), include_translations = $2,
              include_content = $4, description = coalesce($3, description), updated_at = now()
        where id = $1`,
      [id, include_translations, description ?? null, include_content],
    )
    // Chia sẻ luôn chủ đề từ vựng đi kèm (theo đúng luật công khai chủ đề). Không được (chủ đề bị gỡ,
    // không có quyền…) thì bộ vẫn công khai, chỉ báo lại cho giao diện.
    let deck_published = false
    if (publish_deck && c.deck_id && communityService) {
      try {
        await communityService.publish(ctx, c.deck_id, { description: description ?? c.description ?? '' })
        deck_published = true
      } catch {
        deck_published = false
      }
    }
    return { ...(await getCollection(ctx, id)), deck_published }
  }

  async function unpublishCollection(ctx, id) {
    await ownCollection(ctx, id)
    await withTransaction(pool, async (client) => {
      await client.query('update reading_collections set is_public = false, published_at = null where id = $1', [id])
      await client.query('delete from reading_follows where collection_id = $1', [id])
    })
    return { ok: true }
  }

  async function publishReading(ctx, id, { include_translations, include_content }) {
    const r = await ownReading(ctx, id)
    await assertCommunityAllowed(pool, ctx.userId)
    if (r.hidden_at) throw conflict('reading_hidden', 'Bài này đã bị quản trị viên gỡ khỏi cộng đồng.')
    if (!r.content.trim()) throw badRequest('reading_empty', 'Bài đọc chưa có nội dung để chia sẻ.')
    await pool.query(
      `update readings set is_public = true, published_at = coalesce(published_at, now()), include_translations = $2,
              include_content = $3
        where id = $1`,
      [id, include_translations, include_content],
    )
    return getReading(ctx, id)
  }

  async function unpublishReading(ctx, id) {
    await ownReading(ctx, id)
    await withTransaction(pool, async (client) => {
      await client.query('update readings set is_public = false, published_at = null where id = $1', [id])
      await client.query('delete from reading_follows where reading_id = $1', [id])
    })
    return { ok: true }
  }

  // ---------------- Lưu vào thư viện ----------------
  async function follow(ctx, { collectionId, readingId }) {
    const target = collectionId ? await findCollection(ctx, collectionId) : await findReading(ctx, readingId)
    const isPublic = collectionId ? target?.is_public : target?.is_public || target?.collection_public
    if (!target || !isPublic) throw collectionId ? notFoundCollection() : notFoundReading()
    if (target.mine) throw badRequest('own_reading', 'Đây là bài đọc của bạn — không cần lưu vào thư viện.')
    if (!target.followed) {
      await assertWithinQuota(pool, {
        table: 'reading_follows',
        userId: ctx.userId,
        max: quotas.follows,
        what: 'bài đọc đã lưu',
      })
      await pool.query(
        `insert into reading_follows (user_id, collection_id, reading_id) values ($1, $2, $3) on conflict do nothing`,
        [ctx.userId, collectionId ?? null, readingId ?? null],
      )
    }
    return { followed: true }
  }

  async function unfollow({ userId }, { collectionId, readingId }) {
    await pool.query(
      collectionId
        ? 'delete from reading_follows where user_id = $1 and collection_id = $2'
        : 'delete from reading_follows where user_id = $1 and reading_id = $2',
      [userId, collectionId ?? readingId],
    )
    return { followed: false }
  }

  // ---------------- Sao chép ----------------
  // Bản riêng, độc lập: ghi chú giữ nguyên nhưng chưa "lưu" vào Sổ từ của mình; bản dịch chỉ khi được phép.
  async function copyCollection(ctx, id) {
    const view = await getCollection(ctx, id)
    if (view.mine) throw badRequest('own_reading', 'Đây là bộ của bạn — không cần sao chép.')
    await assertWithinQuota(pool, {
      table: 'readings',
      userId: ctx.userId,
      adding: view.readings.length,
      max: quotas.readings,
      what: 'bài đọc',
    })
    // Tạo bộ (kèm chủ đề từ vựng cùng tên, như mọi bộ mới) rồi chép từng trang theo thứ tự.
    const created = await collections.create(ctx, { name: view.name, description: view.description })
    await withTransaction(pool, async (client) => {
      for (const [i, r] of view.readings.entries()) {
        await client.query(
          `insert into readings (user_id, kind, title, content, notes, translations, collection_id, position)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            ctx.userId,
            r.kind,
            r.title,
            r.content,
            JSON.stringify(cleanNotes(r.notes).map((n) => ({ ...n, saved_to: null }))),
            JSON.stringify(r.translations),
            created.id,
            i,
          ],
        )
      }
    })
    const { deck, ...collection } = created
    return {
      collection: { ...collection, reading_count: view.readings.length },
      deck,
      readings_copied: view.readings.length,
    }
  }

  async function copyReading(ctx, id) {
    const view = await getReading(ctx, id)
    if (view.mine) throw badRequest('own_reading', 'Đây là bài của bạn — không cần sao chép.')
    await assertWithinQuota(pool, { table: 'readings', userId: ctx.userId, max: quotas.readings, what: 'bài đọc' })
    const { rows } = await pool.query(
      `insert into readings (user_id, kind, title, content, notes, translations)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [
        ctx.userId,
        view.kind,
        view.title,
        view.content,
        JSON.stringify(cleanNotes(view.notes).map((n) => ({ ...n, saved_to: null }))),
        JSON.stringify(view.translations),
      ],
    )
    return { reading: rows[0] }
  }

  // ---------------- Nhận xét ----------------
  // Luồng: cả bộ (collectionId), 1 trang trong bộ (collectionId + readingId), hoặc 1 bài lẻ (chỉ readingId).
  async function resolveThread(ctx, { collectionId, readingId }) {
    if (collectionId) {
      const c = await findCollection(ctx, collectionId)
      if (!c) throw notFoundCollection()
      if (readingId) {
        const { rowCount } = await pool.query('select 1 from readings where id = $1 and collection_id = $2', [
          readingId,
          collectionId,
        ])
        if (!rowCount) throw badRequest('reading_not_in_collection', 'Bài này không thuộc bộ.')
      }
      return { ownerMine: c.mine, ownerId: c.user_id, title: c.name, collectionId, readingId: readingId ?? null }
    }
    const r = await findReading(ctx, readingId)
    if (!r) throw notFoundReading()
    return {
      ownerMine: r.mine,
      ownerId: r.user_id,
      title: r.title || r.content.slice(0, 60),
      collectionId: null,
      readingId,
    }
  }

  async function listComments(ctx, target) {
    const thread = await resolveThread(ctx, target)
    const { rows } = await pool.query(
      `select rc.id, rc.collection_id, rc.reading_id, rc.body, rc.created_at, ${sqlPublicIdentity('author')},
              (rc.user_id = $1) as mine, (rc.user_id = $1 or $4 or $5) as can_delete
         from reading_comments rc join users u on u.id = rc.user_id
        where rc.deleted_at is null
          and rc.collection_id is not distinct from $2::uuid and rc.reading_id is not distinct from $3::uuid
        order by rc.created_at, rc.id`,
      [ctx.userId, thread.collectionId, thread.readingId, thread.ownerMine, ctx.isSystemAdmin],
    )
    return rows
  }

  async function addComment(ctx, target, { body }) {
    const thread = await resolveThread(ctx, target)
    await assertCommunityAllowed(pool, ctx.userId, { requireVerifiedEmail })
    const { rows } = await pool.query(
      'insert into reading_comments (collection_id, reading_id, user_id, body) values ($1, $2, $3, $4) returning id',
      [thread.collectionId, thread.readingId, ctx.userId, body],
    )
    await notify(thread.ownerId, {
      type: 'reading_comment',
      deckId: null,
      actorId: ctx.userId,
      payload: {
        title: thread.title,
        collection_id: thread.collectionId,
        reading_id: thread.readingId,
        comment_id: rows[0].id,
        url: thread.collectionId
          ? `/explore?rcollection=${thread.collectionId}`
          : `/explore?reading=${thread.readingId}`,
      },
    })
    const list = await listComments(ctx, target)
    return list.find((c) => c.id === rows[0].id)
  }

  async function deleteComment(ctx, commentId) {
    const { rows } = await pool.query(
      `select rc.user_id,
              coalesce((select user_id from reading_collections where id = rc.collection_id),
                       (select user_id from readings where id = rc.reading_id)) as owner_id
         from reading_comments rc where rc.id = $1 and rc.deleted_at is null`,
      [commentId],
    )
    const found = rows[0]
    if (!found) throw notFound('Không tìm thấy nhận xét.')
    if (!(found.user_id === ctx.userId || found.owner_id === ctx.userId || ctx.isSystemAdmin)) {
      throw forbidden('Chỉ người viết hoặc chủ bài đọc mới xoá được nhận xét này.')
    }
    await pool.query('update reading_comments set deleted_at = now(), deleted_by = $2 where id = $1', [
      commentId,
      ctx.userId,
    ])
  }

  return {
    listPublic,
    getCollection,
    getReading,
    publishCollection,
    unpublishCollection,
    publishReading,
    unpublishReading,
    follow,
    unfollow,
    copyCollection,
    copyReading,
    listComments,
    addComment,
    deleteComment,
  }
}
