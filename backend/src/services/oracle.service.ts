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
  private static readonly PRIVACY_THRESHOLD = 2;
  private static readonly WINDOW_SIZE = 20;

  static async getSignal(pairId: string): Promise<OracleSignal> {
    // Query settled orders for the pair — Settlement table is not populated; Order is the source of truth
    const settledOrders = await prisma.order.findMany({
      where: {
        pairId,
        status: { in: ['SETTLED', 'MATCHED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: this.WINDOW_SIZE,
    });

    const sampleSize = settledOrders.length;
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

    // VWAP: sum(price * filledAmount) / sum(filledAmount)
    let totalVolume = 0;
    let totalValue = 0;

    settledOrders.forEach((o) => {
      const price = parseFloat(o.price || '0');
      const filled = parseFloat(o.filledAmount || o.amount || '0');
      totalValue += price * filled;
      totalVolume += filled;
    });

    const vwap = totalVolume > 0 ? totalValue / totalVolume : 0;
    const lastPrice = parseFloat(settledOrders[0].price || '0');
    const priceDiff = vwap > 0 ? Math.abs(lastPrice - vwap) / vwap : 0;
    const strength = Math.min(Math.round(priceDiff * 100), 100);
    const status = lastPrice >= vwap ? 'BULLISH' : 'BEARISH';

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
