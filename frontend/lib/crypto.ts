/**
 * Client-side ECIES encryption for the CRE TEE matching workflow.
 *
 * Scheme: secp256k1 ECDH + SHA-256 + AES-256-GCM
 * Ciphertext layout: compressed_ephemeral_pubkey(33) | iv(12) | gcm_ciphertext_with_tag
 *
 * Uses:
 *  - ethers SigningKey for secp256k1 ECDH (already a dependency)
 *  - Web Crypto API (window.crypto.subtle) for AES-256-GCM
 *
 * The CRE TEE decrypts with @noble/curves/secp256k1 + @noble/ciphers/aes
 * using the same key derivation (SHA-256 of the ECDH x-coordinate).
 */

import { Wallet, SigningKey, getBytes } from "ethers";

/**
 * Encrypt `data` for the CRE TEE.
 *
 * @param data             - Any JSON-serialisable order payload
 * @param crePublicKeyHex  - Compressed secp256k1 public key of the CRE (0x-prefixed or bare hex)
 * @returns Base64 ECIES ciphertext
 */
export async function encryptOrder(data: object, crePublicKeyHex: string): Promise<string> {
    // 1. Generate a fresh ephemeral secp256k1 keypair
    const ephemeralWallet = Wallet.createRandom();
    const ephemeralKey    = new SigningKey(ephemeralWallet.privateKey);

    // 2. ECDH: derive shared point with the CRE's public key
    //    computeSharedSecret returns compressed point: 0x02/0x03 | x (33 bytes)
    const pubkeyHex   = crePublicKeyHex.startsWith("0x") ? crePublicKeyHex : "0x" + crePublicKeyHex;
    const sharedPoint = SigningKey.computeSharedSecret(ephemeralWallet.privateKey, pubkeyHex);
    const sharedX     = getBytes(sharedPoint).slice(1, 33); // x-coordinate only

    // 3. Derive AES-256 key: SHA-256(x)
    const aesKeyRaw = await crypto.subtle.digest("SHA-256", sharedX);
    const aesKey    = await crypto.subtle.importKey(
        "raw",
        aesKeyRaw,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"]
    );

    // 4. Encrypt with AES-256-GCM (12-byte IV, 16-byte auth tag appended by subtle)
    const iv        = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext);

    // 5. Assemble: compressed_ephemeral_pubkey(33) | iv(12) | gcm_ciphertext
    const ephemeralPubBytes = getBytes(ephemeralKey.compressedPublicKey); // 33 bytes
    const cipherBytes       = new Uint8Array(cipherBuf);

    const combined = new Uint8Array(ephemeralPubBytes.length + iv.length + cipherBytes.length);
    combined.set(ephemeralPubBytes, 0);
    combined.set(iv,                ephemeralPubBytes.length);
    combined.set(cipherBytes,       ephemeralPubBytes.length + iv.length);

    // 6. Return base64
    return btoa(String.fromCharCode(...combined));
}
