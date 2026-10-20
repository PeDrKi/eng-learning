import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { validateBody } from '../../middleware/validate.js'
import { createChapterSchema, updateChapterSchema } from './chapters.schemas.js'

// Mọi route ở đây đã qua requireAuth (gắn ở app.js) → luôn có req.user.
export function createChaptersRouter({ chaptersService }) {
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await chaptersService.list(req.access))
  })

  router.post('/', validateBody(createChapterSchema), async (req, res) => {
    res.status(201).json(await chaptersService.create(req.access, req.body))
  })

  router.patch('/:id', uuidParam(), validateBody(updateChapterSchema), async (req, res) => {
    res.json(await chaptersService.update(req.access, req.params.id, req.body))
  })

  router.delete('/:id', uuidParam(), async (req, res) => {
    await chaptersService.remove(req.access, req.params.id)
    res.status(204).end()
  })

  return router
}
