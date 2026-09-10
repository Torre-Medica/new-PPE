import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DispenserSlotEntity } from '@modules/persistence/infrastructure/entities/dispenser-slot.entity';

export interface ChangeBreakdownItem {
  denominationId: number;
  quantity: number;
  subtotal: number;
}

export interface ChangePlan {
  amount: number;
  dispensedTotal: number;
  remaining: number;
  items: ChangeBreakdownItem[];
}

@Injectable()
export class CashChangeService {
  constructor(
    @InjectRepository(DispenserSlotEntity)
    private readonly dispenserSlotRepository: Repository<DispenserSlotEntity>,
  ) {}

  async planChange(amount: number, allowedDenominationIds?: Set<number>): Promise<ChangePlan> {
    if (amount < 0) {
      throw new BadRequestException('El cambio no puede ser negativo');
    }

    if (amount === 0) {
      return { amount: 0, dispensedTotal: 0, remaining: 0, items: [] };
    }

    const slots = await this.dispenserSlotRepository.find({
      where: { isActive: true },
      order: { denominationId: 'DESC' },
    });

    // Aggregate quantities per denomination (multiple slots may have the same denomination)
    const denomMap = new Map<number, number>();
    for (const slot of slots) {
      if (
        slot.denominationId !== null &&
        slot.quantity > 0 &&
        (!allowedDenominationIds || allowedDenominationIds.has(slot.denominationId))
      ) {
        denomMap.set(slot.denominationId, (denomMap.get(slot.denominationId) ?? 0) + slot.quantity);
      }
    }

    // Sort highest denomination first for greedy algorithm
    const sortedDenoms = [...denomMap.entries()].sort((a, b) => b[0] - a[0]);

    let remaining = amount;
    const items: ChangeBreakdownItem[] = [];

    for (const [denominationValue, availableQty] of sortedDenoms) {
      if (remaining <= 0) break;

      const maxUsable = Math.floor(remaining / denominationValue);
      if (maxUsable <= 0) continue;

      const quantity = Math.min(maxUsable, availableQty);
      if (quantity <= 0) continue;

      const subtotal = denominationValue * quantity;
      remaining -= subtotal;
      items.push({ denominationId: denominationValue, quantity, subtotal });
    }

    return {
      amount,
      dispensedTotal: amount - remaining,
      remaining,
      items,
    };
  }
}
