import React, { useState } from 'react';
import { Modal, Button, Icon } from './UI';
import { CONTRACTS, TOKENS, TOKEN_DECIMALS, ERC20_ABI } from '../lib/contracts';
import { VAULT_ABI } from '../lib/abi/valut_abi';
import { useConnection, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { simulateContract, writeContract } from '@wagmi/core'
import { baseSepolia } from 'wagmi/chains';
import { parseUnits } from 'viem';
import { config } from '../lib/wagmi';

interface FundingModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const FundingModal: React.FC<FundingModalProps> = ({ 
    isOpen, 
    onClose
}) => {
    const [step, setStep] = useState<'DETAILS' | 'APPROVING' | 'FUNDING' | 'SUCCESS'>('DETAILS');
    const [amount, setAmount] = useState("10");
    const [token, setToken] = useState<keyof typeof TOKENS>("usdc");
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
    
    const { isConnected, address: eoaAddress, chain } = useConnection();

    // Reset state when modal opens/closes
    React.useEffect(() => {
        if (isOpen) {
            setStep('DETAILS');
            setTxHash(undefined);
            setError(null);
            // Optionally reset amount too, if desired
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

        const nullifierHash = localStorage.getItem("ssl_nullifier_hash");
        if (!nullifierHash) {
            setError("No verified identity found. Please verify with World ID first.");
            return;
        }

        setError(null);
        
        try {
            const tokenAddress = TOKENS[token];
            const vaultAddress = CONTRACTS.vault;
            const decimals = TOKEN_DECIMALS[token.toUpperCase()] || 18; // Handle case mismatch if needed
            const amountUnits = parseUnits(amount, decimals);
            
            // 1. APPROVAL PHASE
            setStep('APPROVING');
            console.log(`Requesting approval for ${amount} ${token} to ${vaultAddress}...`);
            
            

            const { request } = await simulateContract(config, {
                abi: ERC20_ABI,
                address: tokenAddress as `0x${string}`,
                functionName: 'approve',
                args: [
                    vaultAddress as `0x${string}`,
                    amountUnits,
                ],
                account: eoaAddress as `0x${string}`,
                chainId: baseSepolia.id,
            })

            
            const approveHash = await writeContract(config, request)
            
            setTxHash(approveHash);




        } catch (err: any) {
            console.error("Funding failed:", err);
            setError(err.message || "Transaction failed");
            setStep('DETAILS');
        }
    };

    // Sequence controller for the two-step process
    React.useEffect(() => {
        if (isTxSuccess && txHash) {
            if (step === 'APPROVING') {
                // Approval confirmed, now start funding
                const startFunding = async () => {
                    // Reset hash to clear previous success state
                    setTxHash(undefined);
                    setStep('FUNDING');
                    
                    const maxRetries = 5;
                    let retryCount = 0;

                    while (retryCount < maxRetries) {
                        try {
                            const tokenAddress = TOKENS[token];
                            const vaultAddress = CONTRACTS.vault;
                            const decimals = TOKEN_DECIMALS[token.toUpperCase()] || 18;
                            const amountUnits = parseUnits(amount, decimals);
                            
                            console.log(`Funding vault with ${amount} ${token}... (Attempt ${retryCount + 1})`);
                            
                            // Add a small delay on first attempt too, to allow indexer to catch up
                            if (retryCount === 0) await new Promise(r => setTimeout(r, 2000));

                            const { request } = await simulateContract(config, {
                                address: vaultAddress as `0x${string}`,
                                abi: VAULT_ABI,
                                functionName: 'fund',
                                args: [tokenAddress as `0x${string}`, amountUnits],
                                account: eoaAddress as `0x${string}`,
                                chainId: baseSepolia.id,
                            });
                            const fundHash = await writeContract(config, request)
                            setTxHash(fundHash);
                            return; // Success, exit loop
                        } catch (err: any) {
                            console.warn(`Funding simulation failed (Attempt ${retryCount + 1}):`, err);
                            retryCount++;
                            if (retryCount >= maxRetries) {
                                setError(err.message || "Funding failed after approval. Please try again.");
                                setStep('DETAILS'); // Move back to details but keep approval done? ideally we stay in funding or logic to retry? 
                                // Actually better to go to DETAILS so they can click "Review & Deposit" again (which might re-trigger approval check, but approval is already done so it should skip? No, logic currently forces approval every time. That's fine for now.)
                            } else {
                                await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
                            }
                        }
                    }
                };
                startFunding();
            } else if (step === 'FUNDING') {
                // Funding confirmed
                setStep('SUCCESS');
                setTxHash(undefined);
            }
        }
    }, [isTxSuccess, txHash, step, token, amount, writeContract, eoaAddress, chain]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Deposit Confidential Assets">
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
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Asset</label>
                                <select 
                                    className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono outline-none"
                                    value={token}
                                    onChange={(e) => setToken(e.target.value as any)}
                                >
                                    {Object.keys(TOKENS).map(symbol => (
                                        <option key={symbol} value={symbol}>{symbol}</option>
                                    ))}
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
                                    <span className="absolute right-3 top-2.5 text-slate-500 font-mono text-xs">{token}</span>
                                </div>
                            </div>
                        </div>

                        <div className="pt-2">
                            <Button fullWidth variant="primary" icon="account_balance_wallet" onClick={handleFund}>
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
