import crypto from 'crypto';

export function generateCrashPoint(seed, roundNumber) {
  const hash = crypto.createHash('sha256').update(seed + roundNumber).digest('hex');
  const intVal = parseInt(hash.substring(0, 8), 16);
  const crashPoint = Math.max(1.0, (intVal % 10000) / 100.0); 
  return parseFloat(crashPoint.toFixed(2));
}

export function generateMockTxHash() {
  return crypto.randomBytes(16).toString('hex');
}