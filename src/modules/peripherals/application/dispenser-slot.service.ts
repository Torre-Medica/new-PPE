import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  DispenserSlotEntity,
  DispenserSlotKey,
} from '@modules/persistence/infrastructure/entities/dispenser-slot.entity';

export interface DispenserSlotConfig {
  bill1: number | null;
  bill2: number | null;
  coin1: number | null;
  coin2: number | null;
}

export interface UpdateDispenserSlotFields {
  denominationId?: number | null;
  isActive?: boolean;
  quantity?: number;
}

const VALID_SLOT_KEYS: DispenserSlotKey[] = ['bill1', 'bill2', 'coin1', 'coin2'];

@Injectable()
export class DispenserSlotService {
  private readonly logger = new Logger(DispenserSlotService.name);

  constructor(
    @InjectRepository(DispenserSlotEntity)
    private readonly repo: Repository<DispenserSlotEntity>,
  ) {}

  getAll(): Promise<DispenserSlotEntity[]> {
    return this.repo.find({ order: { slotKey: 'ASC' } });
  }

  findOne(slotKey: string): Promise<DispenserSlotEntity | null> {
    if (!VALID_SLOT_KEYS.includes(slotKey as DispenserSlotKey)) {
      return Promise.resolve(null);
    }
    return this.repo.findOne({ where: { slotKey: slotKey as DispenserSlotKey } });
  }

  async update(
    slotKey: string,
    fields: UpdateDispenserSlotFields,
    manager?: EntityManager,
  ): Promise<DispenserSlotEntity> {
    const repo = manager ? manager.getRepository(DispenserSlotEntity) : this.repo;

    if (!VALID_SLOT_KEYS.includes(slotKey as DispenserSlotKey)) {
      throw new NotFoundException(
        `Slot '${slotKey}' no existe. Valores válidos: ${VALID_SLOT_KEYS.join(', ')}`,
      );
    }

    const slot = await repo.findOne({ where: { slotKey: slotKey as DispenserSlotKey } });
    if (!slot) {
      throw new NotFoundException(`Slot '${slotKey}' no encontrado en la base de datos`);
    }

    const nextDenominationId =
      fields.denominationId !== undefined ? fields.denominationId : slot.denominationId;
    const nextIsActive = fields.isActive !== undefined ? fields.isActive : slot.isActive;

    if (fields.denominationId !== undefined) {
      const nextDenominationId = fields.denominationId;
      const denominationChanged = slot.denominationId !== nextDenominationId;

      if (denominationChanged && slot.quantity > 0) {
        const currentDenomination = slot.denominationId
          ? `$${slot.denominationId.toLocaleString('es-CO')}`
          : 'sin denominacion';
        const requestedDenomination = nextDenominationId
          ? `$${nextDenominationId.toLocaleString('es-CO')}`
          : 'sin denominacion';

        this.logger.warn(
          `Cambio de denominacion rechazado en slot '${slotKey}': ` +
          `cantidad actual=${slot.quantity}, actual=${currentDenomination}, solicitada=${requestedDenomination}. ` +
          `El slot debe vaciarse primero (quantity = 0).`,
        );

        throw new ConflictException(
          `No es posible cambiar la denominacion de ${slot.label || slotKey} porque aun tiene ${slot.quantity} unidad(es) cargadas. ` +
          `Primero retire o expulse todo el efectivo de ese slot hasta dejarlo en cero, y luego intente el cambio nuevamente.`,
        );
      }

      slot.denominationId = fields.denominationId;
    }

    if (nextIsActive && nextDenominationId) {
      const duplicateSlot = await repo.findOne({
        where: {
          denominationId: nextDenominationId,
          isActive: true,
        },
      });

      if (duplicateSlot && duplicateSlot.slotKey !== slot.slotKey) {
        throw new ConflictException(
          `No es posible asignar $${nextDenominationId.toLocaleString('es-CO')} a ${slot.label || slotKey} porque esa denominacion ya esta activa en ${duplicateSlot.label || duplicateSlot.slotKey}. ` +
          `Cada slot activo debe manejar una denominacion unica para que el calculo y la devolucion fisica sean exactos.`,
        );
      }
    }

    if (fields.isActive !== undefined) {
      slot.isActive = fields.isActive;
    }

    if (fields.quantity !== undefined) {
      this.logger.log(
        `Slot '${slotKey}': cantidad fisica ${slot.quantity} → ${fields.quantity}`,
      );
      slot.quantity = fields.quantity;
    }

    return repo.save(slot);
  }

  /**
   * Incremento atomico a nivel de DB (UPDATE ... SET quantity = quantity + N),
   * no un read-modify-write — evita perder unidades si dos cargas al mismo slot
   * se solapan (ej. doble-tap del operador).
   */
  async incrementSlotQuantity(
    slotKey: DispenserSlotKey,
    quantity: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(DispenserSlotEntity) : this.repo;
    await repo.increment({ slotKey }, 'quantity', quantity);
  }

  /**
   * Decremento atomico y con guarda: la condicion `quantity >= N` va en el mismo
   * UPDATE, asi que ni siquiera dos descargas/expulsiones concurrentes pueden
   * dejar la cantidad en negativo (a diferencia de un decrement simple, que no
   * tiene piso). Si no hay suficiente, no se modifica nada y se lanza el error.
   */
  async decrementSlotQuantity(
    slotKey: DispenserSlotKey,
    quantity: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(DispenserSlotEntity) : this.repo;
    const result = await repo
      .createQueryBuilder()
      .update(DispenserSlotEntity)
      .set({ quantity: () => 'quantity - :quantity' })
      .where('slot_key = :slotKey AND quantity >= :quantity', { slotKey, quantity })
      .execute();

    if (!result.affected) {
      throw new ConflictException(
        `No hay suficientes unidades en el slot '${slotKey}' para retirar ${quantity} (posible carrera con otra operacion concurrente).`,
      );
    }
  }

  async getSlotConfig(): Promise<DispenserSlotConfig> {
    const slots = await this.getAll();
    const map = new Map(slots.map((s) => [s.slotKey, s]));

    const valueOf = (key: DispenserSlotKey): number | null => {
      const slot = map.get(key);
      return slot?.isActive && slot.denominationId ? slot.denominationId : null;
    };

    return {
      bill1: valueOf('bill1'),
      bill2: valueOf('bill2'),
      coin1: valueOf('coin1'),
      coin2: valueOf('coin2'),
    };
  }
}
