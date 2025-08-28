import express from "express"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import Player from "../models/playerModel.js"
import { getCryptoPrices, isPricesFromFallback } from "../utils/cyrptoCashConvUtil.js"
import { authRequired } from "../middleware/auth.js"

const router = express.Router()

function signSession(player) {
  const payload = { pid: player._id.toString(), username: player.username, email: player.email }
  const token = jwt.sign(payload, process.env.JWT_SECRET || "dev-secret", { expiresIn: "7d" })
  return token
}

function cookieOptions() {
  const isProd = process.env.NODE_ENV === "production"
  return {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd, // must be true with SameSite=None on HTTPS (Render)
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  }
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, amount = 100 } = req.body || {}

    if (!username || !email || !password) {
      return res.status(400).json({ message: "username, email and password are required" })
    }

    const existing = (await Player.findOne({ username })) || (await Player.findOne({ email }))
    if (existing) {
      return res.status(409).json({ message: "User already exists with that username or email" })
    }

    // Fetch prices for initial wallet split; fall back handled by util
    let prices
    try {
      prices = await getCryptoPrices()
    } catch (error) {
      return res.status(503).json({
        message: "Service temporarily unavailable. Please try again later.",
        error: "Price data unavailable",
      })
    }

    // Simple split into BTC/ETH based on prices
    const wallet = {
      BTC: amount / prices.BTC,
      ETH: amount / prices.ETH,
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const player = new Player({
      username,
      email,
      passwordHash,
      amount,
      wallet,
    })
    await player.save()

    const token = signSession(player)
    res
      .cookie("session", token, cookieOptions())
      .status(201)
      .json({
        message: "Registered successfully",
        playerId: player._id,
        username: player.username,
        email: player.email,
        usdBalance: amount,
        wallet,
        priceWarning: isPricesFromFallback() ? "Using estimated prices due to API limitations" : null,
      })
  } catch (err) {
    console.error("[v0] Register error:", err)
    res.status(500).json({ message: "Registration failed: " + err.message })
  }
})

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    // accept any of these fields
    const body = req.body || {}
    const identifier = body.identifier || body.email || body.username || null
    const { password } = body

    if (!identifier || !password) {
      return res.status(400).json({ message: "identifier (username or email) and password are required" })
    }

    const player = (await Player.findOne({ username: identifier })) || (await Player.findOne({ email: identifier }))
    if (!player) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    const ok = await bcrypt.compare(password, player.passwordHash)
    if (!ok) {
      return res.status(401).json({ message: "Invalid credentials" })
    }

    const token = signSession(player)
    return res.cookie("session", token, cookieOptions()).json({
      message: "Logged in",
      playerId: player._id,
      username: player.username,
      email: player.email,
      usdBalance: player.amount,
    })
  } catch (err) {
    console.error("[v0] Login error:", err)
    return res.status(500).json({ message: "Login failed: " + err.message })
  }
})

// POST /api/auth/logout
router.post("/logout", (_req, res) => {
  res.clearCookie("session", { path: "/" })
  res.json({ message: "Logged out" })
})

// GET /api/auth/me
router.get("/me", authRequired, async (req, res) => {
  try {
    const player = await Player.findById(req.user.pid).select("username email amount wallet createdAt updatedAt")
    if (!player) return res.status(404).json({ message: "User not found" })
    res.json({
      player,
      user: {
        id: player._id,
        username: player.username,
        email: player.email,
        amount: player.amount,
        wallet: player.wallet,
      },
    })
  } catch (err) {
    res.status(500).json({ message: "Failed to load profile: " + err.message })
  }
})

export default router
