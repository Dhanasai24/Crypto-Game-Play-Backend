import axios from "axios";

let cachedPrices = null;
let lastFetched = 0;
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

export async function getCryptoPrices() {
  const now = Date.now();

  if (cachedPrices && now - lastFetched < CACHE_TTL) {
    return cachedPrices;
  }

  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price",
      {
        params: {
          ids: "bitcoin,ethereum",
          vs_currencies: "usd",
        },
        headers: {
          "x-cg-demo-api-key": process.env.COINGECKO_API_KEY, // 👈 Key goes here
        },
      }
    );

    const prices = {
      BTC: response.data.bitcoin.usd,
      ETH: response.data.ethereum.usd,
    };

    cachedPrices = prices;
    lastFetched = now;
    return prices;
  } catch (error) {
    console.error("⚠️ CoinGecko fetch failed:", error.message);

    if (cachedPrices) {
      console.warn("➡️ Returning previously stored prices.");
      return cachedPrices;
    }

    throw new Error("❌ Failed to fetch crypto prices and no cached prices available.");
  }
}
