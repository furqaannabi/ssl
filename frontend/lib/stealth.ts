import { ethers } from "ethers";

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
  // Ethers Wallet automatically handles secure random private key generation
  const wallet = ethers.Wallet.createRandom();
  
  // Get uncompressed public key (starts with 0x04)
  const signingKey = new ethers.SigningKey(wallet.privateKey);
  const publicKeyHex = signingKey.publicKey;
  
  return {
    privateKey: wallet.privateKey as `0x${string}`,
    publicKey: publicKeyHex as `0x${string}`,
    address: wallet.address as `0x${string}`
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
  // ECDH using Ethers computation
  const baseSigner = new ethers.SigningKey(spendingPrivateKeyHex);
  const sharedSecretHex = baseSigner.computeSharedSecret(ephemeralPublicKeyHex);
  
  // Hash the shared secret exactly as before
  const sharedHash = ethers.keccak256(sharedSecretHex);

  // stealth private key = (spendingPrivate + sharedHash) mod n
  // The curve order N for secp256k1
  const n = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
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
  const signingKey = new ethers.SigningKey(stealthPrivateKeyHex);
  return ethers.computeAddress(signingKey.publicKey) as `0x${string}`;
}

/**
 * Derives a canonical "Meta-Identity" address from the static spending public key.
 * This can be used as a stable UI identity for the stealth layer.
 */
export function getMetaAddress(publicKey: `0x${string}`): string {
    return ethers.computeAddress(publicKey);
}

/**
 * Get public key from private key hex.
 */
export function getPublicKeyFromPrivate(privateKeyHex: `0x${string}`): `0x${string}` {
  const signingKey = new ethers.SigningKey(privateKeyHex);
  return signingKey.publicKey as `0x${string}`;
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
