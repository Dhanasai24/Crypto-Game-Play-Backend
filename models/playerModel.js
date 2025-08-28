import mongoose from "mongoose"

const walletSchema = {
  BTC: { type: Number, default: 0 },
  ETH: { type: Number, default: 0 },
}

const playerSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    amount: {
      // USD balance
      type: Number,
      default: 0,
      min: 0,
    },
    wallet: walletSchema,
  },
  { timestamps: true },
)

playerSchema.index({ username: 1 }, { unique: true })
playerSchema.index({ email: 1 }, { unique: true })

export default mongoose.model("Player", playerSchema)
