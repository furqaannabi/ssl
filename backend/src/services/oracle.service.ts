import prisma from '../clients/prisma';

export interface OracleSignal {
  status: 'BULLISH' | 'BEARISH' | 'GATHERING_INTEL';
  price: number;
  vwap: number;
  strength: number;
  thresholdMet: boolean;
  sampleSize: number;
}

export class OracleService {
  private static readonly PRIVACY_THRESHOLD = 5;
  private static readonly WINDOW_SIZE = 20;

  static async getSignal(pairId: string): Promise<OracleSignal> {
    const settlements = await prisma.settlement.findMany({
      where: {
        // SETTLED = same-chain settlement done; COMPLETED = cross-chain bridge finished
        status: { in: ['SETTLED', 'COMPLETED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: this.WINDOW_SIZE,
    });

    const sampleSize = settlements.length;
    const thresholdMet = sampleSize >= this.PRIVACY_THRESHOLD;

    if (!thresholdMet) {
      return {
        status: 'GATHERING_INTEL',
        price: 0,
        vwap: 0,
        strength: 0,
        thresholdMet: false,
        sampleSize,
      };
    }

    // VWAP calculation: sum(price * amount) / sum(volume)
    let totalVolume = 0;
    let totalValue = 0;

    settlements.forEach((s: any) => {
      const price = parseFloat(s.amount || '0') / 1000; // Mock price logic if not directly in schema
      const amount = parseFloat(s.amount || '0');
      // Note: Real logic would depend on how price/amount are stored.
      // For the demo, we'll use the 'amount' field as a proxy for price/vol if needed,
      // or assume 'amount' is the settlement value.
      
      // Let's assume s.amount is the price for this demo logic
      const p = parseFloat(s.amount || '0');
      totalValue += p * 1; // Assuming unit volume for simplicity if not present
      totalVolume += 1;
    });

    const vwap = totalValue / totalVolume;
    const lastPrice = parseFloat(settlements[0].amount || '0');
    
    const strength = Math.min(Math.round((Math.abs(lastPrice - vwap) / vwap) * 100), 100);
    const status = lastPrice > vwap ? 'BULLISH' : 'BEARISH';

    return {
      status,
      price: lastPrice,
      vwap,
      strength,
      thresholdMet: true,
      sampleSize,
    };
  }
}
