import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { validateBody } from '../../middleware/validate.js'
import { bulkCreateDecksSchema, createDeckSchema, updateDeckSchema } from './decks.schemas.js'

// Mọi route ở đây đã qua requireAuth (gắn ở app.js) → luôn có req.user.
export function createDecksRouter({ decksService }) {
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await decksService.list(req.access))
  })

  router.post('/', validateBody(createDeckSchema), async (req, res) => {
    res.status(201).json(await decksService.create(req.access, req.body))
  })

  router.post('/bulk', validateBody(bulkCreateDecksSchema), async (req, res) => {
    res.status(201).json(await decksService.bulkCreate(req.access, req.body.decks))
  })

  router.patch('/:id', uuidParam(), validateBody(updateDeckSchema), async (req, res) => {
    res.json(await decksService.update(req.access, req.params.id, req.body))
  })

  router.delete('/:id', uuidParam(), async (req, res) => {
    await decksService.remove(req.access, req.params.id)
    res.status(204).end()
  })

  return router
}
