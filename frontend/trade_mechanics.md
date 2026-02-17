# Trading Mechanics & Pair Structure

## Quote Currency Principle
All trading pairs in the Stealth Pool are structured as **[Asset] / USDC**. 

-   **Base Token**: The asset being traded (e.g., BOND, TBILL, ETH).
-   **Quote Token**: The currency used to price the asset (always **USDC**).

## Trading Logic

### 1. Buying (BID)
When you **BUY** an asset (e.g., BOND), you are swapping **USDC** for **BOND**.
-   **You Pay**: USDC (Quote Token)
-   **You Receive**: BOND (Base Token)
-   *Example: "I want to buy 10 BOND at 100 USDC/each". You pay 1000 USDC.*

### 2. Selling (ASK)
When you **SELL** an asset, you are swapping **BOND** for **USDC**.
-   **You Pay**: BOND (Base Token)
-   **You Receive**: USDC (Quote Token)
-   *Example: "I want to sell 10 BOND at 100 USDC/each". You receive 1000 USDC.*

## Implications
-   **Deposits**: You can deposit *any* supported token (BOND, TBILL, PAXG, etc.) into the Vault.
-   **Liquidity**: To *buy* any of these confidential assets, you must have deposited **USDC**.
-   **Exit**: To *exit* a position, you sell it back into **USDC**, which can then be withdrawn or used to buy other assets.
