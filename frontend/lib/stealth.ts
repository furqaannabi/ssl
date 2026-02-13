import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256, toHex } from "viem";

// ──────────────────────────────────────────────
// Spending Keypair (one-time, stored by user)
// ──────────────────────────────────────────────

export interface SpendingKeypair {
  /** Secret key — NEVER share. Hex "0x..." (32 bytes) */
  privateKey: `0x${string}`;
  /** Public key — send with orders. Hex "0x04..." (uncompressed, 65 bytes) */
  publicKey: `0x${string}`;
}

/**
 * Generate a new spending keypair.
 * Save privateKey in localStorage. Send publicKey with every order.
 */
export function generateSpendingKeypair(): SpendingKeypair {
  const privateKeyBytes = secp256k1.utils.randomPrivateKey();
  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, false);

  return {
    privateKey: toHex(privateKeyBytes),
    publicKey: toHex(publicKeyBytes),
  };
}

// ──────────────────────────────────────────────
// Derive Stealth Private Key (after settlement)
// ──────────────────────────────────────────────

/**
 * Derive the stealth private key so user can import it into MetaMask.
 *
 * @param spendingPrivateKeyHex  User's spending private key "0x..."
 * @param ephemeralPublicKeyHex  Ephemeral public key from CRE settlement response "0x04..."
 * @returns Stealth private key "0x..." — importable into any wallet
 */
export function deriveStealthPrivateKey(
  spendingPrivateKeyHex: `0x${string}`,
  ephemeralPublicKeyHex: `0x${string}`
): `0x${string}` {
  const spendingPrivBytes = hexToBytes(spendingPrivateKeyHex);
  const ephemeralPubBytes = hexToBytes(ephemeralPublicKeyHex);

  // ECDH: shared secret = spendingPrivate * ephemeralPublic
  const sharedPoint = secp256k1.getSharedSecret(spendingPrivBytes, ephemeralPubBytes);
  const sharedHash = keccak256(toHex(sharedPoint));

  // stealth private key = (spendingPrivate + sharedHash) mod n
  const n = secp256k1.CURVE.n;
  const s = BigInt(spendingPrivateKeyHex);
  const h = BigInt(sharedHash);
  const stealthPrivKey = ((s + h) % n + n) % n; // ensure positive

  const hexKey = stealthPrivKey.toString(16).padStart(64, "0");
  return `0x${hexKey}`;
}

/**
 * Get the address for a stealth private key (to verify it matches).
 */
export function stealthPrivateKeyToAddress(
  stealthPrivateKeyHex: `0x${string}`
): `0x${string}` {
  const privBytes = hexToBytes(stealthPrivateKeyHex);
  const pubBytes = secp256k1.getPublicKey(privBytes, false);
  const pubWithoutPrefix = pubBytes.slice(1);
  const addressHash = keccak256(toHex(pubWithoutPrefix));
  return `0x${addressHash.slice(-40)}` as `0x${string}`;
}

// ──────────────────────────────────────────────
// LocalStorage helpers
// ──────────────────────────────────────────────

const SPENDING_KEY_STORAGE = "ssl_spending_keypair";
const STEALTH_KEYS_STORAGE = "ssl_stealth_keys";

/** Save spending keypair to localStorage */
export function saveSpendingKeypair(keypair: SpendingKeypair): void {
  localStorage.setItem(SPENDING_KEY_STORAGE, JSON.stringify(keypair));
}

/** Load spending keypair from localStorage */
export function loadSpendingKeypair(): SpendingKeypair | null {
  const stored = localStorage.getItem(SPENDING_KEY_STORAGE);
  if (!stored) return null;
  return JSON.parse(stored) as SpendingKeypair;
}

/** Get or create spending keypair */
export function getOrCreateSpendingKeypair(): SpendingKeypair {
  const existing = loadSpendingKeypair();
  if (existing) return existing;
  const keypair = generateSpendingKeypair();
  saveSpendingKeypair(keypair);
  return keypair;
}

interface StealthKeyEntry {
  orderId: string;
  stealthAddress: string;
  stealthPrivateKey: string;
  ephemeralPublicKey: string;
  timestamp: number;
}

/** Save a derived stealth key after settlement */
export function saveStealthKey(
  orderId: string,
  stealthAddress: string,
  stealthPrivateKey: `0x${string}`,
  ephemeralPublicKey: string
): void {
  const stored = localStorage.getItem(STEALTH_KEYS_STORAGE);
  const keys: StealthKeyEntry[] = stored ? JSON.parse(stored) : [];
  keys.push({
    orderId,
    stealthAddress,
    stealthPrivateKey,
    ephemeralPublicKey,
    timestamp: Date.now(),
  });
  localStorage.setItem(STEALTH_KEYS_STORAGE, JSON.stringify(keys));
}

/** Load all stealth keys */
export function loadStealthKeys(): StealthKeyEntry[] {
  const stored = localStorage.getItem(STEALTH_KEYS_STORAGE);
  return stored ? JSON.parse(stored) : [];
}

// ──────────────────────────────────────────────
// Util
// ──────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
