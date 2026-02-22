import React, { useState, useEffect } from 'react';
import { Modal, Button, Icon } from './UI';
import { TOKEN_DECIMALS, ERC20_ABI, RWA_TOKENS } from '../lib/contracts';
import { VAULT_ABI } from '../lib/abi/valut_abi';
import { useConnection, useWaitForTransactionReceipt } from 'wagmi';
import { simulateContract, writeContract, getGasPrice } from '@wagmi/core'
import { parseUnits } from 'viem';
import { config } from '../lib/wagmi';
import { CHAINS } from '../lib/chain-config';
import { useSwitchChain } from 'wagmi';
import { auth } from '../lib/auth';

interface FundingModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// Token entry from GET /api/tokens (enriched with price data)
interface TokenEntry {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    chainSelector: string;
    tokenType?: string;
    realSymbol?: string;
    description?: string;
}

export const FundingModal: React.FC<FundingModalProps> = ({ 
    isOpen, 
    onClose
}) => {
    const [step, setStep] = useState<'DETAILS' | 'APPROVING' | 'FUNDING' | 'SUCCESS'>('DETAILS');
    const [amount, setAmount] = useState("10");
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
    
    const [selectedChainId, setSelectedChainId] = useState<number>(84532); // Default Base Sepolia
    const [allTokens, setAllTokens] = useState<TokenEntry[]>([]);
    const [selectedTokenAddress, setSelectedTokenAddress] = useState<string>("");
    const [tokensLoading, setTokensLoading] = useState(false);

    const { isConnected, address: eoaAddress, chain } = useConnection();
    const { switchChainAsync } = useSwitchChain();

    // Fetch tokens from backend on mount
    useEffect(() => {
        const fetchTokens = async () => {
            setTokensLoading(true);
            try {
                const res = await fetch(`/api/tokens`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.success) {
                        setAllTokens(data.tokens || []);
                    }
                }
            } catch (e) { console.error("Failed to fetch tokens", e); }
            finally { setTokensLoading(false); }
        };
        if (isOpen) fetchTokens();
    }, [isOpen]);

    // Filter tokens by selected chain
    const activeChainConfig = Object.values(CHAINS).find(c => c.chainId === selectedChainId);
    const chainSelector = activeChainConfig?.chainSelector || "";
    const dbTokensForChain = allTokens.filter(t => t.chainSelector === chainSelector);

    // Always inject USDC from chain config — its address may be shared across chains
    // so it might not have this chain's chainSelector in DB
    const usdcFromConfig: TokenEntry | null = activeChainConfig?.usdc ? {
        address: activeChainConfig.usdc.toLowerCase(),
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        chainSelector,
        tokenType: 'STABLE',
    } : null;

    const tokensForChain = usdcFromConfig && !dbTokensForChain.find(t => t.address === usdcFromConfig.address)
        ? [...dbTokensForChain, usdcFromConfig]
        : dbTokensForChain;

    const hasVault = !!(activeChainConfig?.vault);

    // Auto-select first token when chain changes or tokens load
    useEffect(() => {
        if (tokensForChain.length > 0 && !tokensForChain.find(t => t.address === selectedTokenAddress)) {
            setSelectedTokenAddress(tokensForChain[0].address);
        }
    }, [chainSelector, tokensForChain.length]);

    const selectedToken = allTokens.find(t => t.address === selectedTokenAddress);

    // Reset state when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setStep('DETAILS');
            setTxHash(undefined);
            setError(null);
        }
    }, [isOpen]);

    // Hook to wait for receipts
    const { isLoading: isWaitingForReceipt, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({
        hash: txHash,
    });

    const handleFund = async () => {
        if (!isConnected) {
            setError("Authority Wallet (EOA) disconnected. Please connect in your profile.");
            return;
        }

        // Gate: contract requires World ID verification on-chain
        const user = await auth.getMe();
        if (!user?.isVerified) {
            setError("World ID verification required before depositing. Go to the Compliance tab to verify.");
            return;
        }

        if (!selectedToken || !activeChainConfig) {
            setError("Please select a valid token and chain.");
            return;
        }

        setError(null);
        
        try {
            // Switch chain if needed
            if (chain?.id !== selectedChainId) {
                try {
                    await switchChainAsync({ chainId: selectedChainId });
                    // Small delay to let the wallet/RPC settle after chain switch
                    await new Promise(r => setTimeout(r, 500));
                } catch (e) {
                    setError("Failed to switch network. Please switch manually in your wallet.");
                    return;
                }
            }

            const vaultAddress = activeChainConfig.vault;
            const tokenAddress = selectedToken.address;
            const decimals = selectedToken.decimals || TOKEN_DECIMALS[selectedToken.symbol] || 18;
            const amountUnits = parseUnits(amount, decimals);
            
            // 1. APPROVAL PHASE
            setStep('APPROVING');
            console.log(`Requesting approval for ${amount} ${selectedToken.symbol} to ${vaultAddress}...`);

            // Fetch current gas price and add 20% buffer to handle base fee fluctuations
            const gasPrice = await getGasPrice(config, { chainId: selectedChainId });
            const gasPriceWithBuffer = (gasPrice * 120n) / 100n;

            const { request } = await simulateContract(config, {
                abi: ERC20_ABI,
                address: tokenAddress as `0x${string}`,
                functionName: 'approve',
                args: [
                    vaultAddress as `0x${string}`,
                    amountUnits,
                ],
                account: eoaAddress as `0x${string}`,
                chainId: selectedChainId,
                gasPrice: gasPriceWithBuffer,
            })

            const approveHash = await writeContract(config, request)
            setTxHash(approveHash);

        } catch (err: any) {
            console.error("Funding failed:", err);
            setError(err.message || "Transaction failed");
            setStep('DETAILS');
        }
    };

    // Sequence controller: approval → fund
    useEffect(() => {
        if (isTxSuccess && txHash) {
            if (step === 'APPROVING') {
                // Approval confirmed, now fund
                const startFunding = async () => {
                    setTxHash(undefined);
                    setStep('FUNDING');
                    
                    if (!selectedToken || !activeChainConfig) return;

                    const maxRetries = 5;
                    let retryCount = 0;

                    while (retryCount < maxRetries) {
                        try {
                            const vaultAddress = activeChainConfig.vault;
                            const tokenAddress = selectedToken.address;
                            const decimals = selectedToken.decimals || TOKEN_DECIMALS[selectedToken.symbol] || 18;
                            const amountUnits = parseUnits(amount, decimals);
                            
                            console.log(`Funding vault with ${amount} ${selectedToken.symbol}... (Attempt ${retryCount + 1})`);
                            
                            // Allow indexer to catch up
                            if (retryCount === 0) await new Promise(r => setTimeout(r, 2000));

                            const gasPrice = await getGasPrice(config, { chainId: selectedChainId });
                            const gasPriceWithBuffer = (gasPrice * 120n) / 100n;

                            const { request } = await simulateContract(config, {
                                address: vaultAddress as `0x${string}`,
                                abi: VAULT_ABI,
                                functionName: 'fund',
                                args: [tokenAddress as `0x${string}`, amountUnits],
                                account: eoaAddress as `0x${string}`,
                                chainId: selectedChainId,
                                gasPrice: gasPriceWithBuffer,
                            });
                            const fundHash = await writeContract(config, request)
                            setTxHash(fundHash);
                            return;
                        } catch (err: any) {
                            console.warn(`Funding simulation failed (Attempt ${retryCount + 1}):`, err);
                            retryCount++;
                            if (retryCount >= maxRetries) {
                                setError(err.message || "Funding failed after approval. Please try again.");
                                setStep('DETAILS');
                            } else {
                                await new Promise(r => setTimeout(r, 2000));
                            }
                        }
                    }
                };
                startFunding();
            } else if (step === 'FUNDING') {
                setStep('SUCCESS');
                setTxHash(undefined);
            }
        }
    }, [isTxSuccess, txHash, step, selectedToken, amount, eoaAddress, chain]);

    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            title="Deposit Confidential Assets"
            isDismissible={step === 'DETAILS' || step === 'SUCCESS'}
        >
            <div className="space-y-6">
                {step === 'DETAILS' && (
                    <>
                        <div className="bg-primary/5 border border-primary/20 p-4 rounded text-xs text-slate-400">
                           <p className="mb-2">Assets will be bound to your <strong>Verified World ID</strong> nullifier. This prevents identity sharing and ensures private settlement.</p>
                           <p className="text-[10px] font-mono opacity-70">FUNDING SOURCE: {eoaAddress || "DISCONNECTED"}</p>
                        </div>

                        <div className="space-y-4">
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 p-3 rounded flex items-center gap-3 text-red-500 text-xs text-center justify-center">
                                    <Icon name="error" className="text-sm shrink-0" />
                                    <p>{error}</p>
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Network</label>
                                <select 
                                    className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono outline-none"
                                    value={selectedChainId}
                                    onChange={async (e) => {
                                        setError(null);
                                        const newChainId = Number(e.target.value);
                                        setSelectedChainId(newChainId);
                                        if (chain?.id !== newChainId && isConnected) {
                                            try {
                                                await switchChainAsync({ chainId: newChainId });
                                            } catch (err) {
                                                console.warn("User rejected or failed to switch chain:", err);
                                                setError("Please switch your wallet network manually to proceed.");
                                            }
                                        }
                                    }}
                                >
                                    {Object.values(CHAINS).map(c => (
                                        <option key={c.chainId} value={c.chainId}>{c.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Asset</label>
                                <select 
                                    className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono outline-none"
                                    value={selectedTokenAddress}
                                    onChange={(e) => setSelectedTokenAddress(e.target.value)}
                                >
                                    {tokensForChain.length > 0 ? (
                                        tokensForChain.map(t => {
                                            const meta = RWA_TOKENS[t.symbol];
                                            const typeLabel = t.tokenType ? ` [${t.tokenType}]` : (meta ? ` [${meta.type}]` : '');
                                            return (
                                                <option key={t.address} value={t.address}>
                                                    {t.symbol}{typeLabel} — {meta?.name || t.name}
                                                </option>
                                            );
                                        })
                                    ) : (
                                        <option disabled>{tokensLoading ? 'Loading tokens...' : 'No tokens on this network'}</option>
                                    )}
                                </select>
                            </div>

                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Amount</label>
                                <div className="relative">
                                    <input 
                                        type="text"
                                        className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono pr-12 outline-none"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                    />
                                    <span className="absolute right-3 top-2.5 text-slate-500 font-mono text-xs">{selectedToken?.symbol || ''}</span>
                                </div>
                            </div>
                        </div>

                        {!hasVault && (
                            <div className="bg-yellow-500/10 border border-yellow-500/20 p-3 rounded text-[10px] text-yellow-400 font-mono flex items-center gap-2">
                                <Icon name="info" className="text-sm shrink-0" />
                                No vault deployed on this network. Deposit unavailable.
                            </div>
                        )}

                        <div className="pt-2">
                            <Button fullWidth variant="primary" icon="account_balance_wallet" onClick={handleFund} disabled={!hasVault}>
                                Review & Deposit
                            </Button>
                        </div>
                    </>
                )}

                {(step === 'APPROVING' || step === 'FUNDING') && (
                    <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                        <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin relative">
                            {isWaitingForReceipt && (
                                <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping"></div>
                            )}
                        </div>
                        <div>
                            <h3 className="text-white font-bold uppercase tracking-wider text-xs">
                                {isWaitingForReceipt 
                                    ? (step === 'APPROVING' ? 'Confirming Approval...' : 'Confirming Deposit...')
                                    : (step === 'APPROVING' ? 'Requesting Approval...' : 'Processing Deposit...')
                                }
                            </h3>
                            <p className="text-[10px] text-slate-500 mt-1 font-mono uppercase tracking-widest">
                                {isWaitingForReceipt ? 'Waiting for block confirmation...' : 'Please confirm in your wallet'}
                            </p>
                            {txHash && (
                                <p className="text-[8px] text-primary/60 mt-2 font-mono break-all max-w-[200px] mx-auto opacity-50">
                                    TX: {txHash}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {step === 'SUCCESS' && (
                    <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                        <div className="w-16 h-16 bg-primary/20 border border-primary rounded-full flex items-center justify-center text-primary shadow-glow">
                            <Icon name="check_circle" className="text-3xl" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold uppercase tracking-wider text-sm">Deposit Successful</h3>
                            <p className="text-[10px] text-slate-400 mt-1 font-mono tracking-wide">Your assets are now shielded and ready for trading.</p>
                        </div>
                        <Button variant="primary" fullWidth onClick={onClose} className="mt-4">Back to Portfolio</Button>
                    </div>
                )}
            </div>
        </Modal>
    );
};
