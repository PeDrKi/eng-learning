import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { validateBody } from '../../middleware/validate.js'
import { createPhraseSchema, updatePhraseProgressSchema, updatePhraseSchema } from './phrases.schemas.js'

export function createPhrasesRouter({ phrasesService }) {
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await phrasesService.list(req.access))
  })

  router.post('/', validateBody(createPhraseSchema), async (req, res) => {
    res.status(201).json(await phrasesService.create(req.access, req.body))
  })

  router.patch('/:id', uuidParam(), validateBody(updatePhraseSchema), async (req, res) => {
    res.json(await phrasesService.update(req.access, req.params.id, req.body))
  })

  // Kết quả ôn một câu — tách khỏi PATCH /:id (nội dung câu) để không lẫn hai loại dữ liệu.
  router.patch('/:id/progress', uuidParam(), validateBody(updatePhraseProgressSchema), async (req, res) => {
    res.json(await phrasesService.updateProgress(req.access, req.params.id, req.body))
  })

  router.delete('/:id', uuidParam(), async (req, res) => {
    await phrasesService.remove(req.access, req.params.id)
    res.status(204).end()
  })

  return router
}
