import { Router } from 'express'
import { uuidParam } from '../../lib/params.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { listUsersQuery, overviewQuery, updateUserSchema } from './admin.schemas.js'

// Mọi route ở đây đã qua requireAuth + requireActiveUser + requireSuperAdmin (gắn ở app.js).
export function createAdminRouter({ adminService }) {
  const router = Router()

  router.get('/overview', validateQuery(overviewQuery), async (req, res) => {
    res.json(await adminService.getOverview(req.validQuery))
  })

  router.get('/users', validateQuery(listUsersQuery), async (req, res) => {
    res.json(await adminService.listUsers(req.validQuery))
  })

  router.patch('/users/:id', uuidParam(), validateBody(updateUserSchema), async (req, res) => {
    res.json(await adminService.updateUser(req.user.id, req.params.id, req.body))
  })

  router.delete('/users/:id', uuidParam(), async (req, res) => {
    await adminService.deleteUser(req.user.id, req.params.id)
    res.status(204).end()
  })

  return router
}
