import jwt from 'jsonwebtoken'
import { assertRoleAllowed, DomainError } from './domain.js'

const secret = () => process.env.JWT_SECRET || 'local-development-secret-change-me'

export function createToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, email: user.email }, secret(), { expiresIn: '8h' })
}

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return next(new DomainError('Authentication required.', 401))
  try {
    const payload = jwt.verify(token, secret())
    req.user = { id: Number(payload.sub), role: payload.role, email: payload.email }
    next()
  } catch {
    next(new DomainError('Invalid or expired token.', 401))
  }
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    try {
      assertRoleAllowed(req.user?.role, roles)
      next()
    } catch (error) {
      next(error)
    }
  }
}