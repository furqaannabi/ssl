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
  /** Derived Stealth Address — Valid Ethereum Address */
  address: `0x${string}`;
}

/**
 * Generate a new spending keypair.
 * Save privateKey in localStorage. Send publicKey with every order.
 */
export function generateSpendingKeypair(): SpendingKeypair {
  const privateKeyBytes = secp256k1.utils.randomPrivateKey();
  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, false);
  const publicKeyHex = toHex(publicKeyBytes);
  
  // Derive address (Hash of pubkey without 0x04 prefix)
  const pubWithoutPrefix = publicKeyBytes.slice(1);
  const addressHash = keccak256(toHex(pubWithoutPrefix));
  const address = `0x${addressHash.slice(-40)}` as `0x${string}`;

  return {
    privateKey: toHex(privateKeyBytes),
    publicKey: publicKeyHex,
    address
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

/**
 * Derives a canonical "Meta-Identity" address from the static spending public key.
 * This can be used as a stable UI identity for the stealth layer.
 */
export function getMetaAddress(publicKey: `0x${string}`): string {
    const pubWithoutPrefix = hexToBytes(publicKey).slice(1);
    const hash = keccak256(toHex(pubWithoutPrefix));
    return `0x${hash.slice(-40)}`;
}

/**
 * Get public key from private key hex.
 */
export function getPublicKeyFromPrivate(privateKeyHex: `0x${string}`): `0x${string}` {
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, false);
  return toHex(publicKeyBytes);
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

/** 
 * Trigger a browser download of the spending keypair.
 */
export function downloadKeyfile(keypair: SpendingKeypair, filename = "ssl_stealth_backup.json"): void {
  const data = JSON.stringify(keypair, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
