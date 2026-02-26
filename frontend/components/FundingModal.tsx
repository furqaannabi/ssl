import React, { useState, useEffect } from 'react';
import { Modal, Button, Icon } from './UI';
import { TOKEN_DECIMALS, ERC20_ABI, RWA_TOKENS } from '../lib/contracts';
import { CONVERGENCE_VAULT_ABI, CONVERGENCE_VAULT_ADDRESS, CONVERGENCE_CHAIN_ID } from '../lib/abi/convergence_vault_abi';
import { useConnection, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { simulateContract, writeContract, getGasPrice } from '@wagmi/core';
import { parseUnits } from 'viem';
import { config } from '../lib/wagmi';

interface FundingModalProps {
    isOpen: boolean;
    onClose: () => void;
    context?: 'portfolio' | 'terminal';
}

interface TokenEntry {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    chainSelector: string;
}

const ETH_SEPOLIA_CHAIN_SELECTOR = 'ethereum-testnet-sepolia';
const USDC_ETH_SEPOLIA = '0x75faf114eafb1bDbe2F0316DF893fd58CE46AA4d';

export const FundingModal: React.FC<FundingModalProps> = ({
    isOpen,
    onClose,
    context = 'portfolio'
}) => {
    const [step, setStep] = useState<'DETAILS' | 'APPROVING' | 'DEPOSITING' | 'SUCCESS'>('DETAILS');
    const [amount, setAmount] = useState('10');
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

    const [allTokens, setAllTokens] = useState<TokenEntry[]>([]);
    const [selectedTokenAddress, setSelectedTokenAddress] = useState<string>('');
    const [tokensLoading, setTokensLoading] = useState(false);

    const { isConnected, address: eoaAddress, chain } = useConnection();
    const { switchChainAsync } = useSwitchChain();

    // Fetch tokens from backend on open
    useEffect(() => {
        const fetchTokens = async () => {
            setTokensLoading(true);
            try {
                const res = await fetch('/api/tokens');
                if (res.ok) {
                    const data = await res.json();
                    if (data.success) setAllTokens(data.tokens || []);
                }
            } catch (e) {
                console.error('Failed to fetch tokens', e);
            } finally {
                setTokensLoading(false);
            }
        };
        if (isOpen) fetchTokens();
    }, [isOpen]);

    // ETH Sepolia tokens only
    const ethSepoliaTokens = allTokens.filter(t => t.chainSelector === ETH_SEPOLIA_CHAIN_SELECTOR);

    // Inject USDC if missing from DB (may be keyed to a different chain selector)
    const tokensForChain: TokenEntry[] = ethSepoliaTokens.find(
        t => t.address.toLowerCase() === USDC_ETH_SEPOLIA.toLowerCase()
    )
        ? ethSepoliaTokens
        : [
              ...ethSepoliaTokens,
              {
                  address: USDC_ETH_SEPOLIA.toLowerCase(),
                  symbol: 'USDC',
                  name: 'USD Coin',
                  decimals: 6,
                  chainSelector: ETH_SEPOLIA_CHAIN_SELECTOR,
              },
          ];

    // Auto-select first available token
    useEffect(() => {
        if (tokensForChain.length > 0 && !tokensForChain.find(t => t.address === selectedTokenAddress)) {
            setSelectedTokenAddress(tokensForChain[0].address);
        }
    }, [tokensForChain.length]);

    const selectedToken = tokensForChain.find(t => t.address === selectedTokenAddress);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setStep('DETAILS');
            setTxHash(undefined);
            setError(null);
        }
    }, [isOpen]);

    const { isLoading: isWaitingForReceipt, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({
        hash: txHash,
    });

    const handleDeposit = async () => {
        if (!isConnected) {
            setError('Connect your wallet first.');
            return;
        }
        if (!selectedToken) {
            setError('Please select a token.');
            return;
        }
        if (!amount || parseFloat(amount) <= 0) {
            setError('Enter a valid amount.');
            return;
        }

        setError(null);

        try {
            // Switch to ETH Sepolia if needed
            if (chain?.id !== CONVERGENCE_CHAIN_ID) {
                try {
                    await switchChainAsync({ chainId: CONVERGENCE_CHAIN_ID });
                    await new Promise(r => setTimeout(r, 500));
                } catch {
                    setError('Please switch to Ethereum Sepolia in your wallet.');
                    return;
                }
            }

            const decimals = selectedToken.decimals || TOKEN_DECIMALS[selectedToken.symbol] || 18;
            const amountUnits = parseUnits(amount, decimals);

            // Step 1 — Approve Convergence vault to spend the token
            setStep('APPROVING');

            const gasPrice = await getGasPrice(config, { chainId: CONVERGENCE_CHAIN_ID });
            const gasPriceWithBuffer = (gasPrice * 120n) / 100n;

            const { request: approveRequest } = await simulateContract(config, {
                abi: ERC20_ABI,
                address: selectedToken.address as `0x${string}`,
                functionName: 'approve',
                args: [CONVERGENCE_VAULT_ADDRESS, amountUnits],
                account: eoaAddress as `0x${string}`,
                chainId: CONVERGENCE_CHAIN_ID,
                gasPrice: gasPriceWithBuffer,
            });

            const approveHash = await writeContract(config, approveRequest);
            setTxHash(approveHash);

        } catch (err: any) {
            console.error('Deposit failed:', err);
            setError(err.shortMessage || err.message || 'Transaction failed');
            setStep('DETAILS');
        }
    };

    // After approval confirms → call deposit()
    useEffect(() => {
        if (!isTxSuccess || !txHash) return;

        if (step === 'APPROVING') {
            const startDeposit = async () => {
                setTxHash(undefined);
                setStep('DEPOSITING');
                if (!selectedToken) return;

                const maxRetries = 5;
                for (let attempt = 0; attempt < maxRetries; attempt++) {
                    try {
                        const decimals = selectedToken.decimals || TOKEN_DECIMALS[selectedToken.symbol] || 18;
                        const amountUnits = parseUnits(amount, decimals);

                        // Allow indexer to catch up after approval
                        if (attempt === 0) await new Promise(r => setTimeout(r, 2000));

                        const gasPrice = await getGasPrice(config, { chainId: CONVERGENCE_CHAIN_ID });
                        const gasPriceWithBuffer = (gasPrice * 120n) / 100n;

                        const { request } = await simulateContract(config, {
                            abi: CONVERGENCE_VAULT_ABI,
                            address: CONVERGENCE_VAULT_ADDRESS,
                            functionName: 'deposit',
                            args: [selectedToken.address as `0x${string}`, amountUnits],
                            account: eoaAddress as `0x${string}`,
                            chainId: CONVERGENCE_CHAIN_ID,
                            gasPrice: gasPriceWithBuffer,
                        });

                        const depositHash = await writeContract(config, request);
                        setTxHash(depositHash);
                        return;

                    } catch (err: any) {
                        console.warn(`Deposit attempt ${attempt + 1} failed:`, err);
                        if (attempt >= maxRetries - 1) {
                            setError(err.shortMessage || err.message || 'Deposit failed after approval. Please try again.');
                            setStep('DETAILS');
                        } else {
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }
                }
            };
            startDeposit();

        } else if (step === 'DEPOSITING') {
            setStep('SUCCESS');
            setTxHash(undefined);
        }
    }, [isTxSuccess, txHash, step]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Deposit to Convergence Vault"
            isDismissible={step === 'DETAILS' || step === 'SUCCESS'}
        >
            <div className="space-y-6">
                {step === 'DETAILS' && (
                    <>
                        <div className="bg-primary/5 border border-primary/20 p-4 rounded text-xs text-slate-400">
                            <p className="mb-1">
                                Tokens are deposited into the{' '}
                                <strong className="text-primary">Convergence private vault</strong> on Ethereum Sepolia.
                                Private transfers at settlement keep your trades confidential.
                            </p>
                            <p className="text-[10px] font-mono opacity-60 mt-2 flex items-center gap-1">
                                <span className="inline-block w-2 h-2 rounded-full bg-green-400 shrink-0"></span>
                                Ethereum Sepolia · {CONVERGENCE_VAULT_ADDRESS.slice(0, 10)}…
                            </p>
                        </div>

                        <div className="space-y-4">
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 p-3 rounded flex items-center gap-3 text-red-500 text-xs">
                                    <Icon name="error" className="text-sm shrink-0" />
                                    <p>{error}</p>
                                </div>
                            )}

                            {/* Network — fixed to ETH Sepolia */}
                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Network</label>
                                <div className="w-full bg-black/50 border border-border-dark text-slate-400 text-sm px-3 py-2.5 font-mono flex items-center gap-2 rounded">
                                    <span className="inline-block w-2 h-2 rounded-full bg-green-400 shrink-0"></span>
                                    Ethereum Sepolia
                                </div>
                            </div>

                            {/* Token selector */}
                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Asset</label>
                                <select
                                    className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono outline-none"
                                    value={selectedTokenAddress}
                                    onChange={e => setSelectedTokenAddress(e.target.value)}
                                >
                                    {tokensForChain.length > 0 ? (
                                        tokensForChain.map(t => {
                                            const meta = RWA_TOKENS[t.symbol];
                                            return (
                                                <option key={t.address} value={t.address}>
                                                    {t.symbol}{meta ? ` [${meta.type}]` : ''} — {meta?.name || t.name}
                                                </option>
                                            );
                                        })
                                    ) : (
                                        <option disabled>{tokensLoading ? 'Loading tokens…' : 'No tokens found'}</option>
                                    )}
                                </select>
                            </div>

                            {/* Amount */}
                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Amount</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono pr-16 outline-none"
                                        value={amount}
                                        min="0"
                                        step="any"
                                        onChange={e => setAmount(e.target.value)}
                                    />
                                    <span className="absolute right-3 top-2.5 text-slate-500 font-mono text-xs">
                                        {selectedToken?.symbol || ''}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="pt-2">
                            <Button
                                fullWidth
                                variant="primary"
                                icon="account_balance_wallet"
                                onClick={handleDeposit}
                                disabled={!isConnected || !selectedToken || !amount || parseFloat(amount) <= 0}
                            >
                                Approve & Deposit
                            </Button>
                            {!isConnected && (
                                <p className="text-[10px] text-slate-500 text-center mt-2 font-mono">Connect your wallet to deposit</p>
                            )}
                        </div>
                    </>
                )}

                {(step === 'APPROVING' || step === 'DEPOSITING') && (
                    <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                        <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin relative">
                            {isWaitingForReceipt && (
                                <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping"></div>
                            )}
                        </div>
                        <div>
                            <h3 className="text-white font-bold uppercase tracking-wider text-xs">
                                {isWaitingForReceipt
                                    ? (step === 'APPROVING' ? 'Confirming Approval…' : 'Confirming Deposit…')
                                    : (step === 'APPROVING' ? 'Requesting Approval…' : 'Depositing to Vault…')
                                }
                            </h3>
                            <p className="text-[10px] text-slate-500 mt-1 font-mono uppercase tracking-widest">
                                {isWaitingForReceipt ? 'Waiting for block confirmation…' : 'Please confirm in your wallet'}
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
                        <div className="w-16 h-16 bg-primary/20 border border-primary rounded-full flex items-center justify-center text-primary">
                            <Icon name="check_circle" className="text-3xl" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold uppercase tracking-wider text-sm">Deposit Successful</h3>
                            <p className="text-[10px] text-slate-400 mt-1 font-mono tracking-wide">
                                Your assets are shielded in the Convergence vault and ready for private trading.
                            </p>
                        </div>
                        <Button variant="primary" fullWidth onClick={onClose} className="mt-4">
                            {context === 'terminal' ? 'Close' : 'Back to Portfolio'}
                        </Button>
                    </div>
                )}
            </div>
        </Modal>
    );
};
