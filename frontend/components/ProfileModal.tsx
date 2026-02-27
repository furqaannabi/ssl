import React, { useState, useEffect } from 'react';
import { Modal, Button, Icon, useToast } from './UI';
import { useConnection, useSignTypedData } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import WorldIdKit from './WorldIdKit';
import { auth } from '../lib/auth';
import { getAddress } from 'viem';

// ─── EIP-712 constants (must match the Convergence API / backend) ─────────────

const SHIELD_DOMAIN = {
    name: 'CompliantPrivateTokenDemo',
    version: '0.0.1',
    chainId: 11155111, // ETH Sepolia
    verifyingContract: '0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13' as `0x${string}`,
} as const;

const SHIELD_TYPES = {
    'Generate Shielded Address': [
        { name: 'account', type: 'address' },
        { name: 'timestamp', type: 'uint256' },
    ],
} as const;

// ─── Shielded Address Generator ───────────────────────────────────────────────

const ShieldedAddressGenerator: React.FC = () => {
    const { address: eoaAddress, isConnected } = useConnection();
    const { toast } = useToast();
    const { signTypedDataAsync } = useSignTypedData();

    const [shieldedAddress, setShieldedAddress] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerate = async () => {
        if (!eoaAddress) {
            toast.error('Connect your wallet first');
            return;
        }

        setIsGenerating(true);
        try {
            const timestamp = Math.floor(Date.now() / 1000);

            // User signs the EIP-712 request with their own wallet
            const signature = await signTypedDataAsync({
                account: getAddress(eoaAddress),
                domain: SHIELD_DOMAIN,
                types: SHIELD_TYPES,
                primaryType: 'Generate Shielded Address',
                message: {
                    account: getAddress(eoaAddress),
                    timestamp: BigInt(timestamp),
                },
            });

            // Backend proxies signed request to the Convergence API
            const res = await fetch('/api/user/shield-address', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ timestamp, auth: signature }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            const { address } = await res.json();
            setShieldedAddress(address);
            toast.success('Shielded address generated');
        } catch (err: any) {
            if (err.message?.includes('User rejected') || err.message?.includes('rejected')) {
                toast.error('Signature rejected');
            } else {
                toast.error(err.message || 'Failed to generate shielded address');
            }
        } finally {
            setIsGenerating(false);
        }
    };

    if (!isConnected) {
        return (
            <div className="text-center py-6 text-slate-500 text-xs font-mono">
                Connect your wallet to generate a shielded address.
            </div>
        );
    }

    if (!shieldedAddress) {
        return (
            <div className="text-center py-6">
                <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-4 border border-primary/20">
                    <Icon name="shield" className="text-2xl text-primary" />
                </div>
                <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-2">Generate Shield Address</h4>
                <p className="text-[10px] text-slate-400 mb-6 font-mono max-w-[260px] mx-auto">
                    A privacy-preserving address linked to your wallet. Tokens sent here are credited back to your account — no private key management required.
                </p>
                <Button fullWidth variant="primary" icon="shield" onClick={handleGenerate} disabled={isGenerating}>
                    {isGenerating ? 'Generating...' : 'Generate Shield Address'}
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 p-3 bg-green-900/10 border border-green-900/30 rounded text-green-400 text-[10px] font-mono">
                <Icon name="check_circle" className="text-lg" />
                <div className="flex-1">
                    <strong className="block mb-0.5 text-green-500">Shield address ready</strong>
                    Paste this into the Shield Address field when placing an order.
                </div>
            </div>

            <div className="space-y-2">
                <label className="text-[9px] text-primary uppercase tracking-widest font-bold flex items-center gap-1">
                    <Icon name="shield" className="text-xs" />
                    Shield Address <span className="text-slate-500 normal-case font-normal">(paste into order form)</span>
                </label>
                <div className="p-2.5 bg-primary/5 border border-primary/30 font-mono text-[11px] text-primary break-all select-all flex justify-between items-center group rounded">
                    <span>{shieldedAddress}</span>
                    <Icon
                        name="content_copy"
                        className="text-primary/50 cursor-pointer hover:text-primary transition-colors shrink-0 ml-2"
                        onClick={() => {
                            navigator.clipboard.writeText(shieldedAddress);
                            toast.success('Shield address copied');
                        }}
                    />
                </div>
            </div>

            <div className="mt-2 pt-3 border-t border-border-dark space-y-3">
                <h5 className="text-[10px] font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                    <Icon name="verified_user" className="text-sm" /> How it works
                </h5>
                <div className="bg-surface-lighter p-3 rounded border border-border-dark space-y-2">
                    <div className="flex gap-3 items-start">
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold border border-primary/50 shrink-0">1</span>
                        <p className="text-[10px] text-slate-300">
                            <strong className="text-primary">Copy the Shield Address</strong> above and paste it into the <strong className="text-white">Shield Address</strong> field when placing an order.
                        </p>
                    </div>
                    <div className="flex gap-3 items-start">
                        <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px] font-bold border border-slate-700 shrink-0">2</span>
                        <p className="text-[10px] text-slate-400">
                            At settlement, tokens are sent privately to your shield address. The Convergence vault links it back to your connected wallet — no key import needed.
                        </p>
                    </div>
                    <div className="flex gap-3 items-start">
                        <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px] font-bold border border-slate-700 shrink-0">3</span>
                        <p className="text-[10px] text-slate-400">
                            Each address is single-use. Generate a new one for each trade to maximise privacy.
                        </p>
                    </div>
                </div>
            </div>

            <Button
                variant="ghost"
                className="text-[10px] h-9 text-slate-500 hover:text-white w-full"
                onClick={() => setShieldedAddress(null)}
            >
                Generate Another
            </Button>
        </div>
    );
};

// ─── ProfileModal ─────────────────────────────────────────────────────────────

export const ProfileModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    const { isConnected } = useConnection();
    const [isHumanVerified, setIsHumanVerified] = useState(false);

    useEffect(() => {
        const checkStatus = async () => {
            const user = await auth.getMe();
            if (user) {
                setIsHumanVerified(user.isVerified);
            }
        };

        if (isOpen) checkStatus();

        const handleVerificationUpdate = () => {
            setIsHumanVerified(true);
            setTimeout(checkStatus, 1000);
        };

        window.addEventListener("world-id-updated", handleVerificationUpdate);
        return () => window.removeEventListener("world-id-updated", handleVerificationUpdate);
    }, [isOpen]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Identity & Access">
            {/* EOA Connection Section (Authority) */}
            <div className="mb-8 p-4 bg-primary/5 border border-primary/20 rounded relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 opacity-10">
                    <Icon name="account_balance_wallet" className="text-3xl text-primary" />
                </div>
                <h4 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Icon name="verified" className="text-xs" /> Authority Wallet (EOA)
                </h4>

                <div className="flex flex-col items-center">
                    <div className="mb-4">
                        <ConnectButton
                            accountStatus="address"
                            chainStatus="icon"
                            showBalance={false}
                        />
                    </div>
                    {isConnected && (
                        <div className="w-full space-y-2">
                            <div className="flex justify-between items-center text-[10px] font-mono">
                                <span className="text-slate-500">Address Origin</span>
                                <span className="text-slate-300">METAMASK / BROWSER</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] font-mono">
                                <span className="text-slate-500">Identity Rights</span>
                                <span className="text-primary">FULL AUTHENTICATION</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Human Verification Section */}
            <div className="mb-8 p-4 bg-blue-900/5 border border-blue-900/20 rounded relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 opacity-10">
                    <Icon name="fingerprint" className="text-3xl text-blue-400" />
                </div>
                <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Icon name="face" className="text-xs" /> Human Verification
                </h4>
                <div className="flex flex-col items-center gap-4">
                    <div className="text-center">
                        {isHumanVerified ? (
                            <div className="flex flex-col items-center text-blue-400">
                                <Icon name="verified" className="text-2xl mb-1" />
                                <span className="text-xs font-mono font-bold">VERIFIED HUMAN</span>
                                <span className="text-[9px] text-slate-500">Credential via World ID</span>
                            </div>
                        ) : (
                            <p className="text-[10px] text-slate-400 mb-2 max-w-[200px]">
                                Verify your unique personhood to access compliant pools.
                            </p>
                        )}
                    </div>
                    {!isHumanVerified && (
                        <div className="w-full max-w-[200px]">
                            <WorldIdKit />
                        </div>
                    )}
                </div>
            </div>

            <div className="h-px bg-border-dark w-full mb-8"></div>

            {/* Shielded Address Generator */}
            <div className="mb-4">
                <ShieldedAddressGenerator />
            </div>

        </Modal>
    );
};
