import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  acceptSuggestionSchema,
  addCommentSchema,
  createSuggestionSchema,
  listSuggestionsQuery,
  rejectSuggestionSchema,
  reportSchema,
  listCommentsQuery,
  listPublicDecksQuery,
  publishDeckSchema,
  unpublishDeckSchema,
} from './community.schemas.js'

export function createCommunityRouter({
  communityService,
  suggestionsService,
  commentLimiter,
  suggestionLimiter,
  reportLimiter,
}) {
  const router = Router()

  // Trang Khám phá: chủ đề đang công khai (tìm theo tên, mô tả, tên người chia sẻ).
  router.get('/decks', validateQuery(listPublicDecksQuery), async (req, res) => {
    res.json(await communityService.listPublic(req.access, req.validQuery))
  })

  router.get('/decks/:id', uuidParam(), async (req, res) => {
    res.json(await communityService.getDeck(req.access, req.params.id))
  })

  router.post('/decks/:id/follow', uuidParam(), async (req, res) => {
    res.json(await communityService.follow(req.access, req.params.id))
  })

  router.delete('/decks/:id/follow', uuidParam(), async (req, res) => {
    await communityService.unfollow(req.access, req.params.id)
    res.status(204).end()
  })

  router.post('/decks/:id/copy', uuidParam(), async (req, res) => {
    res.status(201).json(await communityService.copy(req.access, req.params.id))
  })

  // Chủ sở hữu bật/tắt công khai chủ đề cá nhân của mình.
  router.put('/decks/:id/publish', uuidParam(), validateBody(publishDeckSchema), async (req, res) => {
    res.json(await communityService.publish(req.access, req.params.id, req.body))
  })

  router.post('/decks/:id/unpublish', uuidParam(), validateBody(unpublishDeckSchema), async (req, res) => {
    res.json(await communityService.unpublish(req.access, req.params.id, req.body))
  })

  // ---- Nhận xét ----
  router.get('/decks/:id/comments', uuidParam(), validateQuery(listCommentsQuery), async (req, res) => {
    res.json(await communityService.listComments(req.access, req.params.id, req.validQuery))
  })

  router.post('/decks/:id/comments', uuidParam(), commentLimiter, validateBody(addCommentSchema), async (req, res) => {
    res.status(201).json(await communityService.addComment(req.access, req.params.id, req.body))
  })

  router.delete('/comments/:id', uuidParam(), async (req, res) => {
    await communityService.deleteComment(req.access, req.params.id)
    res.status(204).end()
  })

  // ---- Thông báo & báo cáo vi phạm ----
  router.get('/notifications', async (req, res) => {
    res.json(await communityService.listNotifications(req.access))
  })

  router.post('/notifications/read', async (req, res) => {
    await communityService.markNotificationsRead(req.access)
    res.status(204).end()
  })

  router.post('/reports', reportLimiter, validateBody(reportSchema), async (req, res) => {
    res.status(201).json(await communityService.report(req.access, req.body))
  })

  // ---- Đề xuất chỉnh sửa ----
  router.get('/suggestions/mine', async (req, res) => {
    res.json(await suggestionsService.listMine(req.access))
  })

  router.get('/decks/:id/suggestions', uuidParam(), validateQuery(listSuggestionsQuery), async (req, res) => {
    res.json(await suggestionsService.listForDeck(req.access, req.params.id, req.validQuery))
  })

  router.post(
    '/decks/:id/suggestions',
    uuidParam(),
    suggestionLimiter,
    validateBody(createSuggestionSchema),
    async (req, res) => {
      res.status(201).json(await suggestionsService.create(req.access, req.params.id, req.body))
    },
  )

  router.post('/suggestions/:id/accept', uuidParam(), validateBody(acceptSuggestionSchema), async (req, res) => {
    res.json(await suggestionsService.accept(req.access, req.params.id, req.body))
  })

  router.post('/suggestions/:id/reject', uuidParam(), validateBody(rejectSuggestionSchema), async (req, res) => {
    res.json(await suggestionsService.reject(req.access, req.params.id, req.body))
  })

  router.delete('/suggestions/:id', uuidParam(), async (req, res) => {
    await suggestionsService.withdraw(req.access, req.params.id)
    res.status(204).end()
  })

  return router
}
