import jwt from "jsonwebtoken"

export function authRequired(req, res, next) {
  try {
    const token =
      req.cookies?.session ||
      (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null)

    if (!token) return res.status(401).json({ message: "Unauthorized" })

    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret")
    req.user = payload
    next()
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired session" })
  }
}
