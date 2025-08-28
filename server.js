import express from "express"
import mongoose from "mongoose"
import dotenv from "dotenv"
import gameRoutes from "./routes/index.js"
import cors from "cors"
import http from "http"
import { Server } from "socket.io"

// Import models and utilities needed for game logic
import Player from "./models/playerModel.js"
import Round from "./models/RoundModel.js"
import Transaction from "./models/transaction.js"
import { generateCrashPoint, generateMockTxHash } from "./utils/cyrptoCrashGenUtil.js"
import crypto from "crypto"

dotenv.config()

const app = express()
const server = http.createServer(app)

const allowedOrigins = [
  "https://crypto-gameplay.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
]

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
})

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true)

      if (allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        console.log(`[v0] CORS blocked origin: ${origin}`)
        callback(new Error("Not allowed by CORS"))
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)

app.use(express.json())
app.use("/api/game", gameRoutes)

mongoose
  .connect(process.env.MONGO_URI || "mongodb://localhost:27017/cryptogame", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("[v0] MongoDB connected successfully"))
  .catch((err) => {
    console.error("[v0] MongoDB connection error:", err)
    process.exit(1)
  })

const rooms = {}
const socketToRoom = {}
const userToRoom = {}
const roomLimit = 5

const gameStates = {
  multiplier: {
    isActive: false,
    currentMultiplier: 1.0,
    startTime: null,
    crashPoint: null,
    bets: [],
    cashedOut: [],
    roundNumber: null,
  },
  dice: {
    isRolling: false,
    lastRoll: null,
    activeBets: [],
  },
  lightning: {
    isActive: false,
    currentRound: 0,
    timeLeft: 0,
    multiplier: 1.0,
  },
  targetShooter: {
    isActive: false,
    targets: [],
    activePlayers: [],
    timeLeft: 0,
  },
}

io.on("connection", (socket) => {
  console.log("[v0] Client connected:", socket.id)

  let assignedRoom = null
  for (const roomCode in rooms) {
    if (rooms[roomCode].length < roomLimit) {
      rooms[roomCode].push(socket.id)
      assignedRoom = roomCode
      break
    }
  }

  if (!assignedRoom) {
    assignedRoom = crypto.randomBytes(3).toString("hex")
    rooms[assignedRoom] = [socket.id]
  }

  socketToRoom[socket.id] = assignedRoom
  socket.join(assignedRoom)
  socket.emit("room_assigned", assignedRoom)

  io.to(assignedRoom).emit("group_members", rooms[assignedRoom]) // Broadcast group members to the room

  socket.on("register_player", (playerId) => {
    userToRoom[playerId] = assignedRoom
    console.log(`[v0] Mapped playerId ${playerId} to room ${assignedRoom}`)
  })

  socket.on("place_multiplier_bet", async (data) => {
    try {
      const { playerId, usdAmount, currency = "BTC" } = data

      if (!usdAmount || usdAmount <= 0) {
        return socket.emit("bet_error", { message: "Bet amount must be positive." })
      }

      const player = await Player.findById(playerId)
      if (!player) {
        return socket.emit("bet_error", { message: "Player not found." })
      }

      const mockPrices = { BTC: 30000, ETH: 2000 }
      const price = mockPrices[currency]
      const cryptoAmount = usdAmount / price

      if (player.wallet[currency] < cryptoAmount || player.amount < usdAmount) {
        return socket.emit("bet_error", { message: "Insufficient funds." })
      }

      const newRoundNumber = (await Round.countDocuments()) + 1
      const seed = "server-secret-seed-" + newRoundNumber
      const crashPoint = generateCrashPoint(seed, newRoundNumber)

      player.wallet[currency] -= cryptoAmount
      player.amount -= usdAmount
      await player.save()

      const bet = {
        playerId: player._id,
        usdAmount,
        cryptoAmount,
        currency,
        cashedOut: false,
        multiplier: null,
        socketId: socket.id,
        username: player.username,
      }

      const newRound = new Round({
        roundNumber: newRoundNumber,
        seed,
        crashPoint,
        bets: [bet],
      })
      await newRound.save()

      socket.emit("bet_confirmation", {
        message: "Bet placed successfully!",
        bet: {
          usdAmount,
          cryptoAmount,
          currency,
          roundNumber: newRoundNumber,
          crashPoint: crashPoint,
        },
        usdBalance: player.amount,
        wallet: player.wallet,
        roundNumber: newRoundNumber,
        crashPoint: crashPoint,
      })

      console.log(
        `[v0] Multiplier bet placed by ${player.username} ($${usdAmount} ${currency}) for Round ${newRoundNumber}`,
      )

      const tx = new Transaction({
        playerId: player._id,
        usdAmount,
        cryptoAmount,
        currency,
        transactionType: "bet",
        transactionHash: generateMockTxHash(),
        priceAtTime: price,
      })
      await tx.save()
    } catch (error) {
      console.error("[v0] Error placing multiplier bet:", error)
      socket.emit("bet_error", { message: "Failed to place bet. " + error.message })
    }
  })

  socket.on("cash_out_multiplier", async (data) => {
    try {
      const { playerId, roundNumber, multiplier } = data

      const round = await Round.findOne({ roundNumber })
      if (!round) {
        return socket.emit("cashout_error", { message: "Round not found." })
      }

      const betIndex = round.bets.findIndex((b) => b.playerId.toString() === playerId && !b.cashedOut)
      if (betIndex === -1) {
        return socket.emit("cashout_error", { message: "No active bet found." })
      }

      const bet = round.bets[betIndex]

      if (multiplier >= round.crashPoint) {
        return socket.emit("cashout_error", { message: "Game crashed before cashout!" })
      }

      const winnings = bet.usdAmount * multiplier
      const mockPrices = { BTC: 30000, ETH: 2000 }
      const price = mockPrices[bet.currency]
      const cryptoWon = winnings / price

      const player = await Player.findById(playerId)
      player.wallet[bet.currency] += cryptoWon
      player.amount += winnings
      await player.save()

      bet.cashedOut = true
      bet.multiplier = multiplier
      bet.cashedOutAt = new Date()
      round.bets[betIndex] = bet
      round.markModified("bets")
      await round.save()

      socket.emit("cashout_result", {
        status: "WON",
        message: `Cashed out successfully at ${multiplier.toFixed(2)}x!`,
        result: {
          multiplier: multiplier,
          usdEquivalent: winnings,
        },
      })

      console.log(
        `[v0] Player ${player.username} WON $${winnings.toFixed(2)} (cashed out at ${multiplier.toFixed(2)}x) in Round ${roundNumber}`,
      )

      const tx = new Transaction({
        playerId: player._id,
        usdAmount: winnings,
        cryptoAmount: cryptoWon,
        currency: bet.currency,
        transactionType: "cashout",
        transactionHash: generateMockTxHash(),
        priceAtTime: price,
      })
      await tx.save()
    } catch (error) {
      console.error("[v0] Error cashing out:", error)
      socket.emit("cashout_error", { message: "Failed to cash out. " + error.message })
    }
  })

  socket.on("place_dice_bet", (data) => {
    /* ... existing logic ... */
  })

  socket.on("place_lightning_bet", async (data) => {
    try {
      const { playerId, usdAmount, currency = "BTC" } = data;

      if (!usdAmount || usdAmount <= 0) {
        return socket.emit("bet_error", { message: "Bet amount must be positive." });
      }

      const player = await Player.findById(playerId);
      if (!player) {
        return socket.emit("bet_error", { message: "Player not found." });
      }

      const mockPrices = { BTC: 30000, ETH: 2000 };
      const price = mockPrices[currency];
      const cryptoAmount = usdAmount / price;

      if (player.wallet[currency] < cryptoAmount || player.amount < usdAmount) {
        return socket.emit("bet_error", { message: "Insufficient funds." });
      }

      // Deduct bet amount
      player.wallet[currency] -= cryptoAmount;
      player.amount -= usdAmount;

      // Generate instant multiplier
      const multipliers = [0, 0.5, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 10.0, 25.0];
      const weights = [25, 20, 15, 12, 10, 8, 5, 3, 1.5, 0.4, 0.1];
      let random = Math.random() * 100;
      let selectedMultiplier = 0;
      for (let i = 0; i < weights.length; i++) {
        if (random <= weights[i]) {
          selectedMultiplier = multipliers[i];
          break;
        }
        random -= weights[i];
      }

      const winAmount = usdAmount * selectedMultiplier;
      const isWin = selectedMultiplier > 0;

      if (isWin) {
        const cryptoWon = winAmount / price;
        player.wallet[currency] += cryptoWon;
        player.amount += winAmount;
      }

      await player.save();

      const tx = new Transaction({
        playerId,
        usdAmount: isWin ? winAmount - usdAmount : -usdAmount,
        cryptoAmount: isWin ? (winAmount - usdAmount) / price : -cryptoAmount,
        currency,
        transactionType: isWin ? "lightning_win" : "lightning_loss",
        transactionHash: generateMockTxHash(),
        priceAtTime: price,
      });
      await tx.save();

      socket.emit("lightning_result", {
        playerId,
        username: player.username,
        multiplier: selectedMultiplier,
        winAmount: isWin ? winAmount : 0,
        betAmount: usdAmount,
        newBalance: player.amount,
      });

      console.log(
        `[v0] Lightning bet by ${player.username} ($${usdAmount}) resulted in ${selectedMultiplier}x multiplier. Win: $${winAmount.toFixed(2)}`,
      );
    } catch (error) {
      console.error("[v0] Error placing lightning bet:", error);
      socket.emit("bet_error", { message: "Failed to place bet. " + error.message });
    }
  });

  socket.on("join_target_game", (data) => {
    /* ... existing logic ... */
  })

  socket.on("target_hit", (data) => {
    /* ... existing logic ... */
  })

  socket.on("update_balance", (data) => {
    /* ... existing logic ... */
  })

  socket.emit("game_states", gameStates)

  socket.on("get_game_states", () => {
    socket.emit("game_states", gameStates)
  })

  socket.on("disconnect", async (reason) => {
    console.log(`[v0] Client disconnected: ${socket.id} - Reason: ${reason}`)

    const room = socketToRoom[socket.id]
    if (room) {
      rooms[room] = rooms[room].filter((id) => id !== socket.id)
      if (rooms[room].length === 0) {
        delete rooms[room]
      } else {
        io.to(room).emit("group_members", rooms[room])
      }
      delete socketToRoom[socket.id]
    }

    gameStates.multiplier.bets = gameStates.multiplier.bets.filter((bet) => bet.socketId !== socket.id)
    gameStates.dice.activeBets = gameStates.dice.activeBets.filter((bet) => bet.socketId !== socket.id)
    gameStates.targetShooter.activePlayers = gameStates.targetShooter.activePlayers.filter(
      (player) => player.socketId !== socket.id,
    )

    for (const pId in userToRoom) {
      if (userToRoom[pId] === room && socketToRoom[socket.id] === room) {
        delete userToRoom[pId]
        console.log(`[v0] Removed playerId ${pId} from userToRoom due to socket disconnect.`)
        break
      }
    }
  })
})

app.post("/api/broadcast", (req, res) => {
  const { message } = req.body
  for (const room in rooms) {
    io.to(room).emit("broadcast", message)
  }
  res.status(200).send({ status: "Broadcast sent" })
})

global.userToRoom = userToRoom
global.io = io

const PORT = process.env.PORT || 5000

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[v0] Server running on http://127.0.0.1:${PORT}`)
  console.log(`[v0] Socket.IO server ready`)
  console.log(`[v0] Allowed origins: ${allowedOrigins.join(", ")}`)
})

process.on("SIGTERM", () => {
  console.log("[v0] SIGTERM received, shutting down gracefully")
  server.close(() => {
    console.log("[v0] Server closed")
    mongoose.connection.close(false, () => {
      console.log("[v0] MongoDB connection closed")
      process.exit(0)
    })
  })
})

app.get("/", (req, res) => {
  res.send("🚀 Backend is up and running!");
});

