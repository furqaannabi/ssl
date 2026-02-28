import React, { useState, useEffect } from 'react';
import { Modal, Button, Icon, useToast } from './UI';
import { useConnection, useSignMessage } from 'wagmi';
import { encryptOrder } from '../lib/crypto';
import { fetchCREPublicKey, signEncryptedOrder } from '../lib/cre-client';

interface ParsedOrder {
    side: 'BUY' | 'SELL';
    amount: string;
    price: string;
    symbol: string;
    chain: string;
    pairId?: string;
    chainSelector?: string;
}

interface BalanceCheck {
    hasSufficientBalance: boolean;
    required: string;
    available: string;
    error: string;
}

interface OrderPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    parsed: ParsedOrder | null;
    balanceCheck: BalanceCheck | null;
    totalValue?: string;
    onConfirm: (order: {
        pairId: string;
        amount: string;
        price: string;
        side: 'BUY' | 'SELL';
        shieldAddress: string;
        baseChainSelector: string;
        quoteChainSelector: string;
        encrypted: string;
        signature: string;
    }, onLog?: (log: string) => void) => Promise<{ success: boolean; logs?: string[]; error?: string }>;
}

const CHAIN_OPTIONS = [
    { value: 'ethSepolia', label: 'Ethereum Sepolia' },
];

const ETH_SEPOLIA_SELECTOR = 'ethereum-testnet-sepolia';

export const OrderPreviewModal: React.FC<OrderPreviewModalProps> = ({
    isOpen,
    onClose,
    parsed,
    balanceCheck,
    totalValue: initialTotalValue,
    onConfirm,
}) => {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);

    const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
    const [amount, setAmount] = useState('');
    const [price, setPrice] = useState('');
    const [totalValue, setTotalValue] = useState('');
    const [symbol, setSymbol] = useState('');
    const [chain, setChain] = useState('');
    const [chainSelector, setChainSelector] = useState('');
    const [pairId, setPairId] = useState('');
    const [shieldAddress, setStealthAddress] = useState('');

    const [localBalanceCheck, setLocalBalanceCheck] = useState<BalanceCheck | null>(null);

    // Track which field user is editing to avoid circular updates
    const [editingField, setEditingField] = useState<'amount' | 'totalValue' | null>(null);

    const [orderStatus, setOrderStatus] = useState<'idle' | 'placing' | 'success' | 'error'>('idle');
    const [orderLogs, setOrderLogs] = useState<string[]>([]);

    useEffect(() => {
        if (!isOpen) {
            // Reset state when modal closes
            setOrderStatus('idle');
            setOrderLogs([]);
        }
    }, [isOpen]);

    useEffect(() => {
        if (parsed) {
            setSide(parsed.side || 'BUY');
            setAmount(parsed.amount || '');
            setPrice(parsed.price || '');
            setSymbol(parsed.symbol || '');
            setChain('ethSepolia');
            setChainSelector(ETH_SEPOLIA_SELECTOR);
            setPairId(parsed.pairId || '');
            setLocalBalanceCheck(balanceCheck);

            // Calculate total value from parsed data
            const amt = parseFloat(parsed.amount || '0');
            const prc = parseFloat(parsed.price || '0');
            const total = amt * prc;
            setTotalValue(initialTotalValue || (total > 0 ? total.toFixed(2) : ''));
        }
    }, [parsed, balanceCheck, initialTotalValue]);

    // Handle amount change - update total value
    const handleAmountChange = (value: string) => {
        setAmount(value);
        setEditingField('amount');

        const amt = parseFloat(value);
        const prc = parseFloat(price);
        if (!isNaN(amt) && !isNaN(prc) && prc > 0) {
            const total = amt * prc;
            setTotalValue(total.toFixed(2));
        }
        setEditingField(null);
    };

    // Handle total value change - calculate amount
    const handleTotalValueChange = (value: string) => {
        setTotalValue(value);
        setEditingField('totalValue');

        const total = parseFloat(value);
        const prc = parseFloat(price);
        if (!isNaN(total) && !isNaN(prc) && prc > 0) {
            const amt = total / prc;
            setAmount(amt.toFixed(6));
        }
        setEditingField(null);
    };

    // Handle price change - recalculate both amount and total value
    const handlePriceChange = (value: string) => {
        setPrice(value);

        const prc = parseFloat(value);

        // If editing amount, recalculate total
        if (editingField === 'amount') {
            const amt = parseFloat(amount);
            if (!isNaN(amt) && !isNaN(prc) && prc > 0) {
                const total = amt * prc;
                setTotalValue(total.toFixed(2));
            }
        }

        // If editing total value, recalculate amount
        if (editingField === 'totalValue') {
            const total = parseFloat(totalValue);
            if (!isNaN(total) && !isNaN(prc) && prc > 0) {
                const amt = total / prc;
                setAmount(amt.toFixed(6));
            }
        }
    };

    const calcTotalValue = parseFloat(amount || '0') * parseFloat(price || '0');
    const isValidOrder =
        side &&
        amount &&
        parseFloat(amount) > 0 &&
        price &&
        parseFloat(price) > 0 &&
        chain &&
        pairId &&
        shieldAddress &&
        /^0x[0-9a-fA-F]{40}$/.test(shieldAddress);

    const logsEndRef = React.useRef<HTMLDivElement>(null);

    // Auto scroll logs to bottom
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [orderLogs]);

    const { address } = useConnection();
    const { signMessageAsync } = useSignMessage();

    const handleConfirm = async () => {
        if (!isValidOrder) {
            toast.error('Please fill in all required fields correctly');
            return;
        }

        if (Math.round(calcTotalValue * 100) / 100 < 4.99) {
            toast.error(`Minimum order value is 5 USDC (current: ${calcTotalValue.toFixed(2)} USDC)`);
            return;
        }

        setIsLoading(true);
        setOrderStatus('placing');
        setOrderLogs(['Encrypting order for CRE TEE...']);

        try {
            // Encrypt the order for the CRE TEE before submitting
            const crePublicKey = await fetchCREPublicKey();
            const orderPayload = { pairId, side, amount, price, shieldAddress, userAddress: address || '' };
            const encrypted = await encryptOrder(orderPayload, crePublicKey);
            const signature = await signEncryptedOrder(encrypted, signMessageAsync as any);
            setOrderLogs(prev => [...prev, 'Order encrypted. Submitting...']);
            const result = await onConfirm({
                pairId,
                amount,
                price,
                side,
                shieldAddress,
                baseChainSelector: chainSelector,
                quoteChainSelector: chainSelector,
                encrypted,
                signature,
            }, (log) => {
                // Live log updates while streaming
                setOrderLogs(prev => [...prev, log]);
            });

            if (result.success) {
                setOrderStatus('success');
                if (result.logs) {
                    setOrderLogs(result.logs);
                }
            } else {
                setOrderStatus('error');
                setOrderLogs([result.error || 'Order failed']);
                toast.error(result.error || 'Failed to place order');
            }
        } catch (err: any) {
            setOrderStatus('error');
            setOrderLogs([err.message || 'Failed to place order']);
            toast.error(err.message || 'Failed to place order');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Confirm Order"
        >
            <div className="space-y-4 p-2">
                {/* Order Summary */}
                <div className="bg-surface-dark border border-border-dark rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-xs uppercase">Side</span>
                        <span className={`font-bold text-sm ${side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                            {side}
                        </span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-xs uppercase">Token</span>
                        <span className="text-white font-mono text-sm">{symbol}</span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-xs uppercase">Chain</span>
                        <select
                            value={chain}
                            onChange={(e) => {
                                setChain(e.target.value);
                                setChainSelector(ETH_SEPOLIA_SELECTOR);
                            }}
                            className="bg-black border border-border-dark text-white text-sm px-2 py-1 rounded font-mono focus:border-primary outline-none"
                        >
                            {CHAIN_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-xs uppercase">Price</span>
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500">$</span>
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => handlePriceChange(e.target.value)}
                                className="bg-black border border-border-dark text-white text-sm px-2 py-1 rounded font-mono w-24 text-right focus:border-primary outline-none"
                                placeholder="0.00"
                                step="any"
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-xs uppercase">Token Amount</span>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => handleAmountChange(e.target.value)}
                            className="bg-black border border-border-dark text-white text-sm px-2 py-1 rounded font-mono w-28 text-right focus:border-primary outline-none"
                            placeholder="0.0"
                            step="any"
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-xs uppercase">Total Value (USDC)</span>
                        <div className="flex items-center gap-1">
                            <span className="text-slate-500">$</span>
                            <input
                                type="number"
                                value={totalValue}
                                onChange={(e) => handleTotalValueChange(e.target.value)}
                                className="bg-black border border-border-dark text-white text-sm px-2 py-1 rounded font-mono w-28 text-right focus:border-primary outline-none"
                                placeholder="0.00"
                                step="any"
                            />
                        </div>
                    </div>

                    <hr className="border-border-dark" />

                    <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-xs uppercase">Calculated Total</span>
                        <span className="text-primary font-bold font-mono">
                            ${calcTotalValue.toFixed(2)} USDC
                        </span>
                    </div>
                </div>

                {/* Balance Check */}
                {localBalanceCheck && (
                    <div className={`border rounded-lg p-3 ${localBalanceCheck.hasSufficientBalance
                            ? 'bg-green-900/20 border-green-500/30'
                            : 'bg-red-900/20 border-red-500/30'
                        }`}>
                        <div className="flex items-center gap-2">
                            <Icon
                                name={localBalanceCheck.hasSufficientBalance ? 'check' : 'warning'}
                                className={`text-sm ${localBalanceCheck.hasSufficientBalance ? 'text-green-400' : 'text-red-400'}`}
                            />
                            <span className={`text-xs ${localBalanceCheck.hasSufficientBalance ? 'text-green-400' : 'text-red-400'}`}>
                                {localBalanceCheck.hasSufficientBalance
                                    ? 'Sufficient balance'
                                    : 'Insufficient balance'
                                }
                            </span>
                        </div>
                        {!localBalanceCheck.hasSufficientBalance && localBalanceCheck.error && (
                            <p className="text-red-400/80 text-xs mt-1">{localBalanceCheck.error}</p>
                        )}
                    </div>
                )}

                {/* Stealth Address Input */}
                <div className="space-y-2">
                    <label className="text-slate-400 text-xs uppercase">
                        Shield Address <span className="text-red-400">*</span>
                    </label>
                    <input
                        type="text"
                        value={shieldAddress}
                        onChange={(e) => setStealthAddress(e.target.value)}
                        placeholder="0x..."
                        className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2 rounded font-mono focus:border-primary outline-none"
                    />
                    <p className="text-slate-500 text-[10px]">
                        Generate a shield address in the Profile tab
                    </p>
                </div>

                {/* Min Order Value Warning */}
                {calcTotalValue > 0 && Math.round(calcTotalValue * 100) / 100 < 4.99 && (
                    <div className="bg-yellow-900/20 border border-yellow-500/30 rounded p-2">
                        <p className="text-yellow-400 text-xs">
                            Minimum order value is 5 USDC. Current: ${calcTotalValue.toFixed(2)} USDC
                        </p>
                    </div>
                )}

                {/* Order Status / Logs */}
                {orderStatus !== 'idle' && (
                    <div className="bg-black border border-border-dark rounded-lg p-3 max-h-32 overflow-y-auto">
                        <div className="flex items-center gap-2 mb-2">
                            {orderStatus === 'placing' && (
                                <>
                                    <div className="flex gap-1">
                                        <span className="w-2 h-2 bg-primary rounded-full animate-bounce"></span>
                                        <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                        <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                    </div>
                                    <span className="text-primary text-xs">Processing order...</span>
                                </>
                            )}
                            {orderStatus === 'success' && (
                                <>
                                    <Icon name="check_circle" className="text-green-400 text-sm" />
                                    <span className="text-green-400 text-xs">Order placed!</span>
                                </>
                            )}
                            {orderStatus === 'error' && (
                                <>
                                    <Icon name="warning" className="text-red-400 text-sm" />
                                    <span className="text-red-400 text-xs">Order failed</span>
                                </>
                            )}
                        </div>
                        {orderLogs.length > 0 && (
                            <div className="space-y-1 max-h-24 overflow-y-auto">
                                {orderLogs.map((log, i) => (
                                    <p key={i} className="text-[10px] text-slate-400 font-mono">{log}</p>
                                ))}
                                <div ref={logsEndRef} />
                            </div>
                        )}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                    {orderStatus === 'success' ? (
                        <Button
                            onClick={onClose}
                            className="flex-1"
                        >
                            Close
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="secondary"
                                onClick={onClose}
                                disabled={orderStatus === 'placing'}
                                className="flex-1"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleConfirm}
                                disabled={!isValidOrder || isLoading || orderStatus === 'placing'}
                                className="flex-1"
                            >
                                {isLoading ? 'Placing...' : 'Confirm Order'}
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </Modal>
    );
};
