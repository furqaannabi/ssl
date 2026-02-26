/**
 * Frontend CRE client helpers.
 *
 * Provides:
 *  - fetchCREPublicKey()  — retrieve the TEE's secp256k1 encryption public key
 *  - signOrderPayload()   — sign the encrypted payload with the user's wallet
 */

const API_BASE = "/api";

/**
 * Fetch the CRE TEE's secp256k1 compressed public key (hex).
 * The backend derives this from the CRE_ENCRYPTION_KEY env var.
 */
export async function fetchCREPublicKey(): Promise<string> {
    const res = await fetch(`${API_BASE}/order/cre-pubkey`);
    if (!res.ok) throw new Error("Failed to fetch CRE public key");
    const json = await res.json() as { publicKey: string };
    return json.publicKey;
}

/**
 * Sign the base64-encoded encrypted order payload with the user's wallet.
 * The CRE verifies this signature inside the TEE to confirm order authenticity.
 *
 * @param encryptedBase64  - Base64 ECIES ciphertext produced by encryptOrder()
 * @param signMessageAsync - wagmi signMessage function (or any async signer)
 * @returns 0x-prefixed ECDSA signature hex
 */
export async function signEncryptedOrder(
    encryptedBase64: string,
    signMessageAsync: (args: { message: string }) => Promise<string>
): Promise<string> {
    return signMessageAsync({ message: encryptedBase64 });
}
