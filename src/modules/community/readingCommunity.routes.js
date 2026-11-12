import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  addReadingCommentSchema,
  createReadingSuggestionSchema,
  listPublicReadingsQuery,
  listReadingSuggestionsQuery,
  listReadingCommentsQuery,
  publishCollectionSchema,
  publishReadingSchema,
  reviewReadingSuggestionSchema,
} from './readingCommunity.schemas.js'

// Bài đọc cộng đồng (migration 033) — gắn dưới /community, sau requireUser.
export function createReadingCommunityRouter({
  readingCommunityService: svc,
  readingSuggestionsService: sug,
  commentLimiter,
  suggestionLimiter,
}) {
  const router = Router()

  // Khám phá → tab "Bài đọc": bộ + bài lẻ đang công khai (saved=true: chỉ những gì mình đã lưu).
  router.get('/readings', validateQuery(listPublicReadingsQuery), async (req, res) => {
    const { q, saved } = req.validQuery
    res.json(await svc.listPublic(req.access, { q, saved: saved === 'true' }))
  })

  // ---- Bộ bài đọc ----
  router.get('/reading-collections/:id', uuidParam(), async (req, res) => {
    res.json(await svc.getCollection(req.access, req.params.id))
  })
  router.put(
    '/reading-collections/:id/publish',
    uuidParam(),
    validateBody(publishCollectionSchema),
    async (req, res) => {
      res.json(await svc.publishCollection(req.access, req.params.id, req.body))
    },
  )
  router.post('/reading-collections/:id/unpublish', uuidParam(), async (req, res) => {
    res.json(await svc.unpublishCollection(req.access, req.params.id))
  })
  router.post('/reading-collections/:id/follow', uuidParam(), async (req, res) => {
    res.json(await svc.follow(req.access, { collectionId: req.params.id }))
  })
  router.delete('/reading-collections/:id/follow', uuidParam(), async (req, res) => {
    res.json(await svc.unfollow(req.access, { collectionId: req.params.id }))
  })
  router.post('/reading-collections/:id/copy', uuidParam(), async (req, res) => {
    res.status(201).json(await svc.copyCollection(req.access, req.params.id))
  })
  router.get(
    '/reading-collections/:id/comments',
    uuidParam(),
    validateQuery(listReadingCommentsQuery),
    async (req, res) => {
      res.json(
        await svc.listComments(req.access, { collectionId: req.params.id, readingId: req.validQuery.reading_id }),
      )
    },
  )
  router.post(
    '/reading-collections/:id/comments',
    uuidParam(),
    commentLimiter,
    validateBody(addReadingCommentSchema),
    async (req, res) => {
      const target = { collectionId: req.params.id, readingId: req.body.reading_id ?? undefined }
      res.status(201).json(await svc.addComment(req.access, target, req.body))
    },
  )

  // ---- Bài lẻ ----
  router.get('/readings/:id', uuidParam(), async (req, res) => {
    res.json(await svc.getReading(req.access, req.params.id))
  })
  router.put('/readings/:id/publish', uuidParam(), validateBody(publishReadingSchema), async (req, res) => {
    res.json(await svc.publishReading(req.access, req.params.id, req.body))
  })
  router.post('/readings/:id/unpublish', uuidParam(), async (req, res) => {
    res.json(await svc.unpublishReading(req.access, req.params.id))
  })
  router.post('/readings/:id/follow', uuidParam(), async (req, res) => {
    res.json(await svc.follow(req.access, { readingId: req.params.id }))
  })
  router.delete('/readings/:id/follow', uuidParam(), async (req, res) => {
    res.json(await svc.unfollow(req.access, { readingId: req.params.id }))
  })
  router.post('/readings/:id/copy', uuidParam(), async (req, res) => {
    res.status(201).json(await svc.copyReading(req.access, req.params.id))
  })
  router.get('/readings/:id/comments', uuidParam(), async (req, res) => {
    res.json(await svc.listComments(req.access, { readingId: req.params.id }))
  })
  router.post(
    '/readings/:id/comments',
    uuidParam(),
    commentLimiter,
    validateBody(addReadingCommentSchema),
    async (req, res) => {
      res.status(201).json(await svc.addComment(req.access, { readingId: req.params.id }, req.body))
    },
  )

  // ---- Đề xuất sửa (migration 034) ----
  // Đặt trước '/readings/:id' cho rõ; các đường dẫn tĩnh không trùng mẫu uuid.
  router.get('/reading-suggestions/mine', async (req, res) => {
    res.json(await sug.listMine(req.access))
  })
  router.get('/reading-suggestions/pending-counts', async (req, res) => {
    res.json(await sug.pendingCounts(req.access))
  })
  router.get('/readings/:id/suggestions', uuidParam(), validateQuery(listReadingSuggestionsQuery), async (req, res) => {
    res.json(await sug.listForReading(req.access, req.params.id, req.validQuery))
  })
  router.post(
    '/readings/:id/suggestions',
    uuidParam(),
    suggestionLimiter,
    validateBody(createReadingSuggestionSchema),
    async (req, res) => {
      res.status(201).json(await sug.create(req.access, req.params.id, req.body))
    },
  )
  router.post(
    '/reading-suggestions/:id/accept',
    uuidParam(),
    validateBody(reviewReadingSuggestionSchema),
    async (req, res) => {
      res.json(await sug.accept(req.access, req.params.id, req.body))
    },
  )
  router.post(
    '/reading-suggestions/:id/reject',
    uuidParam(),
    validateBody(reviewReadingSuggestionSchema),
    async (req, res) => {
      res.json(await sug.reject(req.access, req.params.id, req.body))
    },
  )
  router.delete('/reading-suggestions/:id', uuidParam(), async (req, res) => {
    await sug.withdraw(req.access, req.params.id)
    res.status(204).end()
  })

  router.delete('/reading-comments/:id', uuidParam(), async (req, res) => {
    await svc.deleteComment(req.access, req.params.id)
    res.status(204).end()
  })

  return router
}
