import express from "express"
const router = express.Router()
import mongoose from "mongoose"
import Player from "../models/playerModel.js"
import Transaction from "../models/transaction.js"
import { generateMockTxHash } from "../utils/cyrptoCrashGenUtil.js" // fix wrong util import path (typo) to match existing file name
import { getCryptoPrices, isPricesFromFallback } from "../utils/cyrptoCashConvUtil.js"

const currentRoundNumber = 1

router.post("/register", async (req, res) => {
  return res.status(410).json({
    message: "Deprecated. Use POST /api/auth/register for account creation.",
  })
})

/*
  ================================================================================
  WARNING: The /place-bet and /cashout HTTP endpoints are NOT in sync with the
  real-time Socket.IO game logic in server.js. Using them will cause bugs and
  state inconsistencies. All game actions should be handled via Socket.IO events.
  These are commented out to prevent accidental use.
  ================================================================================
router.post("/place-bet", async (req, res) => {
  try {
    const { playerId, usdAmount, currency } = req.body
    const player = await Player.findById(playerId)
    const prices = await getCryptoPrices()

    const price = prices[currency]
    const cryptoAmount = usdAmount / price

    if (player.wallet[currency] < cryptoAmount || player.amount < usdAmount) {
      return res.status(400).json({ message: "Insufficient funds" })
    }

    const seed = "server-secret-seed"
    const crashPoint = generateCrashPoint(seed, currentRoundNumber + randomInt(-1000, 1000))

    player.wallet[currency] -= cryptoAmount
    player.amount -= usdAmount
    await player.save()

    const bet = {
      playerId,
      usdAmount,
      cryptoAmount,
      currency,
      cashedOut: false,
      multiplier: null,
    }

    let round = await Round.findOne({ roundNumber: currentRoundNumber })
    if (!round) {
      round = new Round({ roundNumber: currentRoundNumber, seed, crashPoint, bets: [bet] })
    } else {
      round.bets.push(bet)
    }
    await round.save()
    const room = global.userToRoom[playerId]
    if (room) {
      global.io.to(room).emit("broadcast", `${player.username || playerId} placed $${usdAmount} bet.`)
    }
    const tx = new Transaction({
      playerId,
      usdAmount,
      cryptoAmount,
      currency,
      transactionType: "bet",
      transactionHash: generateMockTxHash(),
      priceAtTime: price,
    })
    await tx.save()

    res.json({
      message: "Bet placed",
      bet: {
        amount: usdAmount,
        cryptoAmount,
        cashedOut: false,
        payout: 0,
        status: "IN GAME",
        cashedOutAt: null,
        roundNumber: round.roundNumber,
      },
      roundNumber: round.roundNumber,
      crashPoint,
    })
  } catch (err) {
    console.error(err)
    res.status(500).send("Server error")
  }
})

router.post("/cashout", async (req, res) => {
  try {
    const { playerId, roundNumber, multiplier } = req.body
    const round = await Round.findOne({ roundNumber })
    const bet = round.bets.find((b) => b.playerId.toString() === playerId && !b.cashedOut)

    if (!bet) return res.status(404).json({ message: "No valid bet found" })
    if (multiplier > round.crashPoint) return res.status(400).json({ message: "Crash happened before cashout" })

    const cryptoWon = bet.cryptoAmount * multiplier
    const prices = await getCryptoPrices()
    const usdEquivalent = cryptoWon * prices[bet.currency]

    await Player.findByIdAndUpdate(playerId, {
      $inc: {
        [`wallet.${bet.currency}`]: cryptoWon,
        amount: usdEquivalent,
      },
    })

    bet.cashedOut = true
    bet.multiplier = multiplier
    await round.save()
    const player = await Player.findById(playerId)
    const room = global.userToRoom[playerId]
    if (room) {
      global.io.to(room).emit("broadcast", `${player.username || playerId} cashedout an amount of $${usdEquivalent}.`)
    }

    const tx = new Transaction({
      playerId,
      usdAmount: usdEquivalent,
      cryptoAmount: cryptoWon,
      currency: bet.currency,
      transactionType: "cashout",
      transactionHash: generateMockTxHash(),
      priceAtTime: prices[bet.currency],
    })
    await tx.save()

    res.json({
      message: "Cashed out",
      result: {
        cryptoWon,
        usdEquivalent,
        multiplier,
        roundNumber,
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).send("Server error")
  }
})
*/

router.post("/dice-bet", async (req, res) => {
  try {
    const { playerId, usdAmount, prediction, rollUnder = true, currency = "BTC" } = req.body
    const player = await Player.findById(playerId)

    let prices
    try {
      prices = await getCryptoPrices()
    } catch (error) {
      console.error("[v0] Price fetch failed during dice bet:", error.message)
      return res.status(503).json({
        message: "Unable to process bet due to price data issues. Please try again.",
        error: "Price service unavailable",
      })
    }

    const price = prices[currency]
    const cryptoAmount = usdAmount / price

    if (player.wallet[currency] < cryptoAmount || player.amount < usdAmount) {
      return res.status(400).json({ message: "Insufficient funds" })
    }

    // Enhanced dice roll (1-100 instead of 1-6)
    const diceRoll = Math.floor(Math.random() * 100) + 1
    let isWin = false
    let multiplier = 0

    if (rollUnder) {
      isWin = diceRoll < prediction
      multiplier = isWin ? (99 / prediction) * 0.99 : 0 // 1% house edge
    } else {
      isWin = diceRoll > prediction
      multiplier = isWin ? (99 / (100 - prediction)) * 0.99 : 0 // 1% house edge
    }

    const winAmount = usdAmount * multiplier

    player.wallet[currency] -= cryptoAmount
    player.amount -= usdAmount

    if (isWin) {
      const cryptoWon = winAmount / price
      player.wallet[currency] += cryptoWon
      player.amount += winAmount
    }

    await player.save()

    const tx = new Transaction({
      playerId,
      usdAmount: isWin ? winAmount - usdAmount : -usdAmount,
      cryptoAmount: isWin ? (winAmount - usdAmount) / price : -cryptoAmount,
      currency,
      transactionType: isWin ? "dice_win" : "dice_loss",
      transactionHash: generateMockTxHash(),
      priceAtTime: price,
    })
    await tx.save()

    // Enhanced socket broadcast
    const room = global.userToRoom[playerId]
    if (room && global.io) {
      global.io.to(room).emit("dice_result", {
        playerId,
        username: player.username,
        roll: diceRoll,
        prediction,
        rollUnder,
        isWin,
        winAmount: isWin ? winAmount : 0,
        multiplier,
      })
    }

    res.json({
      result: {
        diceRoll,
        isWin,
        winAmount: isWin ? winAmount : 0,
        multiplier,
        prediction,
        rollUnder,
      },
      wallet: player.wallet,
      usdBalance: player.amount,
    })
  } catch (err) {
    console.error("[v0] Dice bet error:", err)
    res.status(500).json({ message: "Server error: " + err.message })
  }
})

router.post("/lightning-bet", async (req, res) => {
  try {
    const { playerId, usdAmount, currency = "BTC" } = req.body
    const player = await Player.findById(playerId)

    let prices
    try {
      prices = await getCryptoPrices()
    } catch (error) {
      console.error("[v0] Price fetch failed during lightning bet:", error.message)
      return res.status(503).json({
        message: "Unable to process bet due to price data issues. Please try again.",
        error: "Price service unavailable",
      })
    }

    const price = prices[currency]
    const cryptoAmount = usdAmount / price

    if (player.wallet[currency] < cryptoAmount || player.amount < usdAmount) {
      return res.status(400).json({ message: "Insufficient funds" })
    }

    // Enhanced multiplier system with better distribution
    const multipliers = [0, 0.5, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 10.0, 25.0]
    const weights = [25, 20, 15, 12, 10, 8, 5, 3, 1.5, 0.4, 0.1]

    let random = Math.random() * 100
    let selectedMultiplier = 0

    for (let i = 0; i < weights.length; i++) {
      if (random <= weights[i]) {
        selectedMultiplier = multipliers[i]
        break
      }
      random -= weights[i]
    }

    const winAmount = usdAmount * selectedMultiplier

    player.wallet[currency] -= cryptoAmount
    player.amount -= usdAmount

    if (selectedMultiplier > 0) {
      const cryptoWon = winAmount / price
      player.wallet[currency] += cryptoWon
      player.amount += winAmount
    }

    await player.save()

    const tx = new Transaction({
      playerId,
      usdAmount: selectedMultiplier > 0 ? winAmount - usdAmount : -usdAmount,
      cryptoAmount: selectedMultiplier > 0 ? (winAmount - usdAmount) / price : -cryptoAmount,
      currency,
      transactionType: selectedMultiplier > 0 ? "lightning_win" : "lightning_loss",
      transactionHash: generateMockTxHash(),
      priceAtTime: price,
    })
    await tx.save()

    // Enhanced socket broadcast
    const room = global.userToRoom[playerId]
    if (room && global.io) {
      global.io.to(room).emit("lightning_result", {
        playerId,
        username: player.username,
        multiplier: selectedMultiplier,
        winAmount: selectedMultiplier > 0 ? winAmount : 0,
        betAmount: usdAmount,
      })
    }

    res.json({
      result: {
        multiplier: selectedMultiplier,
        winAmount: selectedMultiplier > 0 ? winAmount : 0,
        betAmount: usdAmount,
      },
      wallet: player.wallet,
      usdBalance: player.amount,
    })
  } catch (err) {
    console.error("[v0] Lightning bet error:", err)
    res.status(500).json({ message: "Server error: " + err.message })
  }
})

router.post("/target-bet", async (req, res) => {
  try {
    const { playerId, usdAmount, accuracy, targets = 1, currency = "BTC" } = req.body
    const player = await Player.findById(playerId)

    let prices
    try {
      prices = await getCryptoPrices()
    } catch (error) {
      console.error("[v0] Price fetch failed during target bet:", error.message)
      return res.status(503).json({
        message: "Unable to process bet due to price data issues. Please try again.",
        error: "Price service unavailable",
      })
    }

    const price = prices[currency]
    const cryptoAmount = usdAmount / price

    if (player.wallet[currency] < cryptoAmount || player.amount < usdAmount) {
      return res.status(400).json({ message: "Insufficient funds" })
    }

    // Enhanced skill-based multiplier calculation
    const baseMultiplier = Math.max(0, (accuracy / 100) * 2.5)
    const targetBonus = targets * 0.1 // Bonus for multiple targets
    const skillBonus = accuracy > 90 ? 0.5 : accuracy > 75 ? 0.3 : accuracy > 50 ? 0.1 : 0

    const finalMultiplier = baseMultiplier + targetBonus + skillBonus
    const winAmount = usdAmount * finalMultiplier

    player.wallet[currency] -= cryptoAmount
    player.amount -= usdAmount

    if (finalMultiplier > 0) {
      const cryptoWon = winAmount / price
      player.wallet[currency] += cryptoWon
      player.amount += winAmount
    }

    await player.save()

    const tx = new Transaction({
      playerId,
      usdAmount: finalMultiplier > 0 ? winAmount - usdAmount : -usdAmount,
      cryptoAmount: finalMultiplier > 0 ? (winAmount - usdAmount) / price : -cryptoAmount,
      currency,
      transactionType: finalMultiplier > 0 ? "target_win" : "target_loss",
      transactionHash: generateMockTxHash(),
      priceAtTime: price,
    })
    await tx.save()

    // Enhanced socket broadcast
    const room = global.userToRoom[playerId]
    if (room && global.io) {
      global.io.to(room).emit("target_result", {
        playerId,
        username: player.username,
        accuracy,
        targets,
        multiplier: finalMultiplier,
        winAmount: finalMultiplier > 0 ? winAmount : 0,
        skillBonus: skillBonus > 0,
      })
    }

    res.json({
      result: {
        accuracy,
        targets,
        multiplier: finalMultiplier,
        winAmount: finalMultiplier > 0 ? winAmount : 0,
        skillBonus: skillBonus > 0,
        baseMultiplier,
        targetBonus,
      },
      wallet: player.wallet,
      usdBalance: player.amount,
    })
  } catch (err) {
    console.error("[v0] Target bet error:", err)
    res.status(500).json({ message: "Server error: " + err.message })
  }
})

router.get("/wallet/:playerId", async (req, res) => {
  try {
    const player = await Player.findById(req.params.playerId)

    let prices
    try {
      prices = await getCryptoPrices()
    } catch (err) {
      console.error("[v0] Price fetch failed for wallet:", err.message)
      return res.status(503).json({
        message: "Price data temporarily unavailable. Please try again later.",
        error: "Price service unavailable",
      })
    }

    const walletUSD = {}
    for (const coin in player.wallet) {
      walletUSD[coin] = {
        crypto: player.wallet[coin],
        usd: (player.wallet[coin] * prices[coin]).toFixed(2),
      }
    }

    res.json({
      wallet: walletUSD,
      usdBalance: player.amount.toFixed(2),
      priceSource: isPricesFromFallback() ? "estimated" : "live",
    })
  } catch (err) {
    console.error("[v0] Wallet fetch error:", err)
    res.status(500).json({ message: "Error fetching wallet: " + err.message })
  }
})

router.get("/dashboard-stats", async (req, res) => {
  try {
    const totalPlayers = await Player.countDocuments()
    const totalTransactions = await Transaction.countDocuments()

    const volumeResult = await Transaction.aggregate([
      { $group: { _id: null, total: { $sum: { $abs: "$usdAmount" } } } },
    ])
    const totalVolume = volumeResult[0]?.total || 0

    const recentTransactions = await Transaction.find()
      .populate("playerId", "username")
      .sort({ createdAt: -1 })
      .limit(10)

    const gameStats = await Transaction.aggregate([
      {
        $group: {
          _id: "$transactionType",
          count: { $sum: 1 },
          volume: { $sum: { $abs: "$usdAmount" } },
        },
      },
    ])

    res.json({
      totalPlayers,
      totalTransactions,
      totalVolume,
      recentTransactions,
      gameStats,
      onlinePlayers: Object.keys(global.userToRoom || {}).length,
    })
  } catch (err) {
    console.error(err)
    res.status(500).send("Server error")
  }
})

router.get("/leaderboard", async (req, res) => {
  try {
    const { gameType = "all", timeframe = "all" } = req.query

    // Overall leaderboard
    const topPlayers = await Player.find().sort({ amount: -1 }).limit(10).select("username amount createdAt")

    // Game-specific stats
    const gameFilter = {}
    if (gameType !== "all") {
      gameFilter.transactionType = { $regex: gameType }
    }

    // Time filter
    if (timeframe !== "all") {
      const now = new Date()
      const startDate = new Date()

      switch (timeframe) {
        case "daily":
          startDate.setDate(now.getDate() - 1)
          break
        case "weekly":
          startDate.setDate(now.getDate() - 7)
          break
        case "monthly":
          startDate.setMonth(now.getMonth() - 1)
          break
      }

      gameFilter.createdAt = { $gte: startDate }
    }

    const gameLeaderboard = await Transaction.aggregate([
      { $match: gameFilter },
      {
        $group: {
          _id: "$playerId",
          totalWinnings: { $sum: "$usdAmount" },
          totalBets: { $sum: 1 },
          biggestWin: { $max: "$usdAmount" },
        },
      },
      { $sort: { totalWinnings: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "players",
          localField: "_id",
          foreignField: "_id",
          as: "player",
        },
      },
      { $unwind: "$player" },
    ])

    const totalStats = {
      totalPlayers: await Player.countDocuments(),
      totalTransactions: await Transaction.countDocuments(gameFilter),
      totalVolume:
        (
          await Transaction.aggregate([
            { $match: gameFilter },
            { $group: { _id: null, total: { $sum: { $abs: "$usdAmount" } } } },
          ])
        )[0]?.total || 0,
    }

    res.json({
      topPlayers,
      gameLeaderboard,
      stats: totalStats,
      filters: { gameType, timeframe },
    })
  } catch (err) {
    console.error(err)
    res.status(500).send("Server error")
  }
})

router.get("/player-stats/:playerId", async (req, res) => {
  try {
    const { playerId } = req.params
    const player = await Player.findById(playerId)

    if (!player) {
      return res.status(404).json({ message: "Player not found" })
    }

    const transactions = await Transaction.find({ playerId }).sort({ createdAt: -1 })

    let totalBets = 0
    let netProfit = 0
    let biggestWin = 0

    transactions.forEach((tx) => {
      if (tx.transactionType === "bet" || tx.transactionType.endsWith("_loss")) {
        totalBets += 1
      }

      if (tx.transactionType === "bet") {
        netProfit -= tx.usdAmount
      } else {
        netProfit += tx.usdAmount
      }

      if (tx.usdAmount > 0 && (tx.transactionType.endsWith("_win") || tx.transactionType === "cashout")) {
        if (tx.usdAmount > biggestWin) {
          biggestWin = tx.usdAmount
        }
      }
    })

    const stats = {
      totalBets,
      netProfit,
      biggestWin,
      currentBalance: player.amount,
    }

    const gameStats = await Transaction.aggregate([
      { $match: { playerId: new mongoose.Types.ObjectId(playerId) } },
      { $group: { _id: "$transactionType", count: { $sum: 1 }, volume: { $sum: "$usdAmount" } } },
    ])

    res.json({ stats, recentTransactions: transactions.slice(0, 50), gameStats })
  } catch (err) {
    console.error(err)
    res.status(500).send("Server error")
  }
})

export default router
