import React, { useState, useEffect } from 'react';
import { Modal, Button, Icon } from './UI';
import { TOKEN_DECIMALS, RWA_TOKENS, ETH_SEPOLIA_TOKENS } from '../lib/contracts';
import { CONVERGENCE_VAULT_ABI, CONVERGENCE_VAULT_ADDRESS, CONVERGENCE_CHAIN_ID } from '../lib/abi/convergence_vault_abi';
import { useConnection, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { simulateContract, writeContract, getGasPrice, signTypedData } from '@wagmi/core';
import { parseUnits, getAddress } from 'viem';
import { config } from '../lib/wagmi';
import { Asset } from '../types';

const CONVERGENCE_VAULT: `0x${string}` = CONVERGENCE_VAULT_ADDRESS;

const CONVERGENCE_DOMAIN = {
    name: 'CompliantPrivateTokenDemo',
    version: '0.0.1',
    chainId: 11155111,
    verifyingContract: CONVERGENCE_VAULT,
} as const;

const WITHDRAW_TYPES = {
    'Withdraw Tokens': [
        { name: 'account', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'timestamp', type: 'uint256' },
    ],
} as const;

interface WithdrawalModalProps {
    isOpen: boolean;
    onClose: () => void;
    assets: Asset[];  // vault balances from Portfolio (after Check Balances)
}

export const WithdrawalModal: React.FC<WithdrawalModalProps> = ({ isOpen, onClose, assets }) => {
    const [step, setStep] = useState<'DETAILS' | 'SIGNING' | 'CONFIRMING' | 'SUCCESS'>('DETAILS');
    const [amount, setAmount] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
    const [deadline, setDeadline] = useState<number | null>(null);
    const [selectedTokenAddress, setSelectedTokenAddress] = useState<string>('');

    const { isConnected, address: eoaAddress, chain } = useConnection();
    const { switchChainAsync } = useSwitchChain();

    // Auto-select first token with vault balance (or first overall)
    useEffect(() => {
        if (!isOpen) return;
        const withBalance = ETH_SEPOLIA_TOKENS.find(t => {
            const a = assets.find(a => a.symbol === t.symbol);
            return (a?.balance ?? 0) > 0;
        });
        setSelectedTokenAddress((withBalance ?? ETH_SEPOLIA_TOKENS[0])?.address ?? '');
    }, [isOpen, assets]);

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            setStep('DETAILS');
            setTxHash(undefined);
            setError(null);
            setAmount('');
            setDeadline(null);
        }
    }, [isOpen]);

    const selectedToken = ETH_SEPOLIA_TOKENS.find(t => t.address === selectedTokenAddress);
    const vaultBalance = assets.find(a => a.symbol === selectedToken?.symbol)?.balance ?? 0;

    const { isLoading: isWaitingForReceipt, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({ hash: txHash });

    useEffect(() => {
        if (isTxSuccess && step === 'CONFIRMING') setStep('SUCCESS');
    }, [isTxSuccess, step]);

    const handleWithdraw = async () => {
        if (!isConnected || !eoaAddress) { setError('Connect your wallet first.'); return; }
        if (!selectedToken) { setError('Select a token.'); return; }
        const amountNum = parseFloat(amount);
        if (!amount || isNaN(amountNum) || amountNum <= 0) { setError('Enter a valid amount.'); return; }
        if (assets.length > 0 && amountNum > vaultBalance) {
            setError(`Insufficient vault balance. Available: ${vaultBalance.toFixed(4)} ${selectedToken.symbol}`);
            return;
        }

        setError(null);

        try {
            // Switch to ETH Sepolia if needed
            if (chain?.id !== CONVERGENCE_CHAIN_ID) {
                try { await switchChainAsync({ chainId: CONVERGENCE_CHAIN_ID }); }
                catch { setError('Please switch to Ethereum Sepolia in your wallet.'); return; }
            }

            const decimals = selectedToken.decimals || TOKEN_DECIMALS[selectedToken.symbol] || 18;
            const amountWei = parseUnits(amount, decimals);
            const timestamp = Math.floor(Date.now() / 1000);

            // Step 1 — sign EIP-712 "Withdraw Tokens"
            setStep('SIGNING');
            const sig = await signTypedData(config, {
                account: eoaAddress as `0x${string}`,
                domain: CONVERGENCE_DOMAIN,
                types: WITHDRAW_TYPES,
                primaryType: 'Withdraw Tokens',
                message: {
                    account: getAddress(eoaAddress),
                    token: selectedToken.address as `0x${string}`,
                    amount: amountWei,
                    timestamp: BigInt(timestamp),
                },
            });

            // Step 2 — backend proxy → Convergence /withdraw → receive ticket
            const ticketRes = await fetch('/api/user/withdraw-ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    token: selectedToken.address,
                    amount: amountWei.toString(),
                    timestamp,
                    auth: sig,
                }),
            });

            if (!ticketRes.ok) {
                const err = await ticketRes.json().catch(() => ({}));
                throw new Error((err as any).error || 'Failed to get withdrawal ticket');
            }

            const { ticket, deadline: dl } = await ticketRes.json();
            setDeadline(dl);

            // Step 3 — call withdrawWithTicket on vault
            setStep('CONFIRMING');
            const gasPrice = await getGasPrice(config, { chainId: CONVERGENCE_CHAIN_ID });

            const { request } = await simulateContract(config, {
                abi: CONVERGENCE_VAULT_ABI,
                address: CONVERGENCE_VAULT_ADDRESS,
                functionName: 'withdrawWithTicket',
                args: [selectedToken.address as `0x${string}`, amountWei, ticket as `0x${string}`],
                account: eoaAddress as `0x${string}`,
                chainId: CONVERGENCE_CHAIN_ID,
                gasPrice: (gasPrice * 120n) / 100n,
            });

            const hash = await writeContract(config, request);
            setTxHash(hash);

        } catch (err: any) {
            console.error('Withdrawal failed:', err);
            setError(err.shortMessage || err.message || 'Withdrawal failed');
            setStep('DETAILS');
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Withdraw from Vault"
            isDismissible={step === 'DETAILS' || step === 'SUCCESS'}
        >
            <div className="space-y-6">

                {/* ── DETAILS ── */}
                {step === 'DETAILS' && (
                    <>
                        <div className="bg-yellow-500/5 border border-yellow-500/20 p-4 rounded text-xs text-yellow-400/80">
                            <p className="mb-1 uppercase font-bold text-[10px] tracking-wider">Privacy Notice</p>
                            <p>Withdrawals redeem tokens from the Convergence vault to your public wallet address.</p>
                        </div>

                        {assets.length === 0 && (
                            <div className="bg-primary/5 border border-primary/20 p-3 rounded text-xs text-slate-400 flex items-center gap-2">
                                <Icon name="info" className="text-primary text-sm shrink-0" />
                                Use <strong className="text-primary">Check Balances</strong> on the Portfolio page first to see your vault holdings.
                            </div>
                        )}

                        <div className="space-y-4">
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 p-3 rounded flex items-center gap-3 text-red-400 text-xs">
                                    <Icon name="error" className="text-sm shrink-0" />
                                    {error}
                                </div>
                            )}

                            {/* Network — fixed */}
                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Network</label>
                                <div className="w-full bg-black/50 border border-border-dark text-slate-400 text-sm px-3 py-2.5 font-mono flex items-center gap-2 rounded">
                                    <span className="inline-block w-2 h-2 rounded-full bg-green-400 shrink-0"></span>
                                    Ethereum Sepolia · Convergence Vault
                                </div>
                            </div>

                            {/* Token */}
                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Asset</label>
                                <select
                                    className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono outline-none"
                                    value={selectedTokenAddress}
                                    onChange={e => { setSelectedTokenAddress(e.target.value); setAmount(''); }}
                                >
                                    {ETH_SEPOLIA_TOKENS.map(t => {
                                        const meta = RWA_TOKENS[t.symbol];
                                        const bal = assets.find(a => a.symbol === t.symbol)?.balance ?? 0;
                                        return (
                                            <option key={t.address} value={t.address}>
                                                {t.symbol}{meta ? ` [${meta.type}]` : ''} — {meta?.name || t.name}
                                                {assets.length > 0 ? ` (${bal > 0 ? bal.toFixed(4) : '0'})` : ''}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>

                            {/* Amount */}
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Amount</label>
                                    {assets.length > 0 && (
                                        <span className="text-[10px] font-mono text-slate-400">
                                            Vault: <span className="text-primary">{vaultBalance.toFixed(4)}</span> {selectedToken?.symbol}
                                        </span>
                                    )}
                                </div>
                                <div className="relative">
                                    <input
                                        type="number"
                                        className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono pr-24 outline-none"
                                        value={amount}
                                        min="0"
                                        step="any"
                                        placeholder="0.00"
                                        onChange={e => setAmount(e.target.value)}
                                    />
                                    <div className="absolute right-3 top-2 flex items-center gap-2">
                                        {vaultBalance > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setAmount(vaultBalance.toString())}
                                                className="text-[10px] text-primary border border-primary/30 px-1.5 py-0.5 rounded hover:bg-primary/10 transition-colors font-mono"
                                            >
                                                Max
                                            </button>
                                        )}
                                        <span className="text-slate-500 font-mono text-xs">{selectedToken?.symbol || ''}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="pt-2 space-y-2">
                            <Button
                                fullWidth
                                variant="destroy"
                                icon="logout"
                                onClick={handleWithdraw}
                                disabled={!isConnected || !selectedToken || !amount || parseFloat(amount) <= 0}
                            >
                                Sign & Withdraw
                            </Button>
                            <p className="text-[10px] text-slate-600 text-center font-mono">
                                2 steps: sign EIP-712 → confirm on-chain tx
                            </p>
                        </div>
                    </>
                )}

                {/* ── SIGNING ── */}
                {step === 'SIGNING' && (
                    <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                        <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        <div>
                            <h3 className="text-white font-bold uppercase tracking-wider text-xs">Signing Request…</h3>
                            <p className="text-[10px] text-slate-500 mt-1 font-mono">Confirm the EIP-712 message in your wallet</p>
                        </div>
                    </div>
                )}

                {/* ── CONFIRMING ── */}
                {step === 'CONFIRMING' && (
                    <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                        <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin relative">
                            {isWaitingForReceipt && <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping"></div>}
                        </div>
                        <div>
                            <h3 className="text-white font-bold uppercase tracking-wider text-xs">
                                {isWaitingForReceipt ? 'Confirming On-Chain…' : 'Confirm in Wallet…'}
                            </h3>
                            <p className="text-[10px] text-slate-500 mt-1 font-mono">
                                {isWaitingForReceipt ? 'Waiting for block confirmation' : 'Confirm withdrawWithTicket()'}
                            </p>
                            {deadline && (
                                <p className="text-[10px] text-yellow-400/70 mt-2 font-mono">
                                    Ticket expires {new Date(deadline * 1000).toLocaleTimeString()}
                                </p>
                            )}
                            {txHash && (
                                <p className="text-[8px] text-primary/50 mt-2 font-mono break-all max-w-[220px] mx-auto">TX: {txHash}</p>
                            )}
                        </div>
                    </div>
                )}

                {/* ── SUCCESS ── */}
                {step === 'SUCCESS' && (
                    <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                        <div className="w-16 h-16 bg-primary/20 border border-primary rounded-full flex items-center justify-center text-primary">
                            <Icon name="check_circle" className="text-3xl" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold uppercase tracking-wider text-sm">Withdrawal Complete</h3>
                            <p className="text-[10px] text-slate-400 mt-1 font-mono tracking-wide">
                                Tokens have been redeemed from the Convergence vault to your wallet.
                            </p>
                        </div>
                        <Button variant="primary" fullWidth onClick={onClose} className="mt-4">
                            Back to Portfolio
                        </Button>
                    </div>
                )}

            </div>
        </Modal>
    );
};
