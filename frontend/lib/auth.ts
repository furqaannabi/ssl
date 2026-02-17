


// Use relative path to leverage Vite Proxy (solves CORS/Cookie issues)
const API_URL = ""; 


export interface User {
  id: string;
  address: string;
  isVerified: boolean;
  balances: { token: string; balance: string }[];
}

export const auth = {
  /**
   * Fetches a nonce for the given address.
   */
  async getNonce(address: string): Promise<string> {
    const res = await fetch(`${API_URL}/api/auth/nonce/${address}`);
    if (!res.ok) throw new Error("Failed to fetch nonce");
    const data = await res.json();
    return data.nonce;
  },

  /**
   * Logs in the user by signing a nonce.
   * @param address The user's wallet address.
   * @param signMessageAsync logic from wagmi to sign the message
   */
  async login(address: string, signMessageAsync: (args: { message: string }) => Promise<string>): Promise<boolean> {
    try {
      // 1. Get Nonce
      const nonce = await this.getNonce(address);

      // 2. Sign Message
      const signature = await signMessageAsync({ message: nonce });

      // 3. Login
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature }),
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error("Login failed");
      }
      
      return true;
    } catch (error) {
      console.error("Auth login error:", error);
      return false;
    }
  },

  /**
   * Fetches the current authenticated user.
   */
  async getMe(): Promise<User | null> {
    try {
      // Note: Credentials (cookies) are sent automatically by browser if SameSite/CORS is configured correctly.
      // If not, we might need verify credentials: 'include'
      const res = await fetch(`${API_URL}/api/user/me`, {
          credentials: 'include',
          cache: 'no-store',
      });
      
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error("Failed to fetch user");
      
      const data = await res.json();
      return data.user;
    } catch (error) {
      return null;
    }
  },
  
  async logout() {
      // Backend likely needs a logout route to clear HTTPOnly cookie.
      // For now, we can only clear client state.
  }
};
