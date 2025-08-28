import axios from "axios"

let cachedPrices = null
let lastFetched = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes cache

const FALLBACK_PRICES = {
  BTC: 43000,
  ETH: 2600,
}

export async function getCryptoPrices() {
  const now = Date.now()

  // Return cached prices if still valid
  if (cachedPrices && now - lastFetched < CACHE_TTL) {
    console.log("[v0] Using cached crypto prices")
    return cachedPrices
  }

  try {
    const headers = {
      "User-Agent": "CryptoGame/1.0",
      Accept: "application/json",
    }

    if (process.env.COINGECKO_API_KEY) {
      headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY
    }

    const apiUrl = process.env.CRYPTO_API_URL || "https://api.coingecko.com/api/v3/simple/price"

    console.log("[v0] Fetching crypto prices from:", apiUrl)

    const response = await axios.get(apiUrl, {
      params: {
        ids: "bitcoin,ethereum",
        vs_currencies: "usd",
      },
      headers,
      timeout: 10000, // 10 second timeout
    })

    const prices = {
      BTC: response.data.bitcoin?.usd || FALLBACK_PRICES.BTC,
      ETH: response.data.ethereum?.usd || FALLBACK_PRICES.ETH,
    }

    cachedPrices = prices
    lastFetched = now
    console.log("[v0] Successfully fetched crypto prices:", prices)
    return prices
  } catch (error) {
    console.error("⚠️ CoinGecko fetch failed:", error.message)

    if (cachedPrices) {
      console.warn("➡️ Using previously cached prices due to API failure")
      return cachedPrices
    }

    console.warn("➡️ Using fallback mock prices due to API failure and no cache")
    cachedPrices = FALLBACK_PRICES
    lastFetched = now
    return FALLBACK_PRICES
  }
}

export function isPricesFromFallback() {
  return cachedPrices === FALLBACK_PRICES
}

export function clearPriceCache() {
  cachedPrices = null
  lastFetched = 0
  console.log("[v0] Price cache cleared")
}
