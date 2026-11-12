import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { closeReportSchema, listReportsQuery } from './community.schemas.js'

// Kiểm duyệt cộng đồng — gắn ở /admin/community, sau requireSuperAdmin (xem app.js).
export function createModerationRouter({ moderationService }) {
  const router = Router()
  const done = (res) => res.status(204).end()

  router.get('/reports', validateQuery(listReportsQuery), async (req, res) => {
    res.json(await moderationService.listReports(req.validQuery))
  })

  router.post('/reports/:id/close', uuidParam(), validateBody(closeReportSchema), async (req, res) => {
    await moderationService.closeReport(req.access, req.params.id, req.body)
    done(res)
  })

  router.post('/decks/:id/hide', uuidParam(), async (req, res) => {
    await moderationService.setDeckHidden(req.access, req.params.id, true)
    done(res)
  })

  router.post('/decks/:id/unhide', uuidParam(), async (req, res) => {
    await moderationService.setDeckHidden(req.access, req.params.id, false)
    done(res)
  })

  router.post('/comments/:id/hide', uuidParam(), async (req, res) => {
    await moderationService.setCommentHidden(req.access, req.params.id, true)
    done(res)
  })

  router.post('/comments/:id/unhide', uuidParam(), async (req, res) => {
    await moderationService.setCommentHidden(req.access, req.params.id, false)
    done(res)
  })

  // Bài đọc cộng đồng (migration 033): gỡ / trả lại bộ bài đọc, bài đọc, nhận xét ở bài đọc.
  for (const [path, type] of [
    ['reading-collections', 'reading_collection'],
    ['readings', 'reading'],
    ['reading-comments', 'reading_comment'],
  ]) {
    router.post(`/${path}/:id/hide`, uuidParam(), async (req, res) => {
      await moderationService.setReadingContentHidden(req.access, type, req.params.id, true)
      done(res)
    })
    router.post(`/${path}/:id/unhide`, uuidParam(), async (req, res) => {
      await moderationService.setReadingContentHidden(req.access, type, req.params.id, false)
      done(res)
    })
  }

  router.post('/users/:id/block', uuidParam(), async (req, res) => {
    await moderationService.setUserBlocked(req.access, req.params.id, true)
    done(res)
  })

  router.post('/users/:id/unblock', uuidParam(), async (req, res) => {
    await moderationService.setUserBlocked(req.access, req.params.id, false)
    done(res)
  })

  return router
}
