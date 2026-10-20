import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { validateBody } from '../../middleware/validate.js'
import { createGroupSchema, joinGroupSchema, memberRoleSchema, renameGroupSchema } from './groups.schemas.js'

export function createGroupsRouter({ groupsService, joinLimiter }) {
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await groupsService.list(req.access))
  })

  router.post('/', validateBody(createGroupSchema), async (req, res) => {
    res.status(201).json(await groupsService.create(req.access, req.body))
  })

  router.post('/join', joinLimiter, validateBody(joinGroupSchema), async (req, res) => {
    res.json(await groupsService.join(req.access, req.body))
  })

  router.patch('/:id', uuidParam(), validateBody(renameGroupSchema), async (req, res) => {
    res.json(await groupsService.rename(req.access, req.params.id, req.body))
  })

  router.post('/:id/invite-code', uuidParam(), async (req, res) => {
    res.json(await groupsService.regenerateInviteCode(req.access, req.params.id))
  })

  router.patch(
    '/:id/members/:userId',
    uuidParam(),
    uuidParam('userId'),
    validateBody(memberRoleSchema),
    async (req, res) => {
      res.json(await groupsService.setMemberRole(req.access, req.params.id, req.params.userId, req.body))
    },
  )

  router.delete('/:id/members/:userId', uuidParam(), uuidParam('userId'), async (req, res) => {
    await groupsService.removeMember(req.access, req.params.id, req.params.userId)
    res.status(204).end()
  })

  router.get('/:id/stats', uuidParam(), async (req, res) => {
    res.json(await groupsService.stats(req.access, req.params.id))
  })

  // Bản cũ của dashboard (trả từng dòng tiến trình để client tự tính). Giữ lại cho bản FE cũ còn
  // nằm trong cache PWA của người dùng; FE mới dùng /stats ở trên.
  router.get('/:id/progress', uuidParam(), async (req, res) => {
    res.json(await groupsService.progress(req.access, req.params.id))
  })

  return router
}
