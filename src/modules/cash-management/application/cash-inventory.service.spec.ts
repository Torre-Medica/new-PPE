import { CashInventoryService } from '@modules/cash-management/application/cash-inventory.service';
import { CashIncidentType } from '@modules/persistence/infrastructure/entities/cash-incident.entity';

type CloseoutReceiptPayload = {
  sections: Array<{
    title: string;
    rows: Array<{ item: string; quantity?: number; total?: number }>;
  }>;
};

type CloseoutReceiptPayloadBuilder = {
  buildCloseoutReceiptPayload(args: {
    closeoutId: number;
    closeoutType: 'PARTIAL' | 'TOTAL';
    periodStartedAt: Date;
    periodEndedAt: Date;
    closedBy: string;
    notes: string | null;
    completedPayments: unknown[];
    acceptedMovements: unknown[];
    dispensedMovements: unknown[];
    hopperLoadMovements: unknown[];
    hopperInitialTotal: number;
    dispenserSlots: unknown[];
    incidents: unknown[];
  }): CloseoutReceiptPayload;
};

describe('CashInventoryService closeout receipt', () => {
  const createService = () =>
    new CashInventoryService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('adds a summary with payment count, payment total, entered cash, and returned cash', () => {
    const service = createService();

    const payload = (service as unknown as CloseoutReceiptPayloadBuilder).buildCloseoutReceiptPayload({
      closeoutId: 10,
      closeoutType: 'TOTAL',
      periodStartedAt: new Date('2026-07-03T00:00:00.000Z'),
      periodEndedAt: new Date('2026-07-03T23:59:59.000Z'),
      closedBy: 'admin',
      notes: null,
      completedPayments: [
        {
          targetAmount: 32000,
          concept: 'Parqueadero',
          vehicleType: 'CAR',
          metadataJson: null,
          changeCommandsJson: JSON.stringify([
            { slotKey: 'bill1', requestedDenomination: 1000, quantity: 2 },
          ]),
        },
        {
          targetAmount: 15000,
          concept: 'Parqueadero',
          vehicleType: 'MOTO',
          metadataJson: null,
          changeCommandsJson: JSON.stringify([
            { slotKey: 'coin1', requestedDenomination: 500, quantity: 2 },
          ]),
        },
      ],
      acceptedMovements: [
        {
          denominationId: 20000,
          denomination: { kind: 'BILL' },
          quantity: 2,
          totalValue: 40000,
        },
        {
          denominationId: 10000,
          denomination: { kind: 'BILL' },
          quantity: 1,
          totalValue: 10000,
        },
      ],
      dispensedMovements: [],
      hopperLoadMovements: [],
      hopperInitialTotal: 0,
      dispenserSlots: [],
      incidents: [],
    });

    expect(payload.sections[0]).toEqual({
      title: 'Resumen',
      rows: [
        { item: 'Cantidad pagos', quantity: 2 },
        { item: 'Total pagos', total: 47000 },
        { item: 'Dinero ingresado', total: 50000 },
        { item: 'Dinero devuelto', total: 3000 },
        { item: 'Recaudo neto', total: 47000 },
      ],
    });
  });

  it('reports novedades in their own section without mixing them into received/returned totals', () => {
    const service = createService();

    const payload = (service as unknown as CloseoutReceiptPayloadBuilder).buildCloseoutReceiptPayload({
      closeoutId: 11,
      closeoutType: 'TOTAL',
      periodStartedAt: new Date('2026-07-03T00:00:00.000Z'),
      periodEndedAt: new Date('2026-07-03T23:59:59.000Z'),
      closedBy: 'admin',
      notes: null,
      completedPayments: [],
      acceptedMovements: [
        {
          denominationId: 5000,
          denomination: { kind: 'BILL' },
          quantity: 1,
          totalValue: 5000,
        },
      ],
      dispensedMovements: [],
      hopperLoadMovements: [],
      hopperInitialTotal: 0,
      dispenserSlots: [],
      incidents: [
        { type: CashIncidentType.RejectedLargeBill, amount: 50000 },
        { type: CashIncidentType.UndispensableChange, amount: 50 },
      ],
    });

    const novedadesSection = payload.sections.find((s) => s.title === 'Novedades');
    expect(novedadesSection).toBeDefined();
    expect(novedadesSection!.rows).toHaveLength(2);
    expect(novedadesSection).toMatchObject({
      total: 50050,
    });

    // El total de "Dinero recibido" (Resumen) NO debe incluir los 50000/50 de novedades.
    expect(payload.sections[0]).toEqual({
      title: 'Resumen',
      rows: [
        { item: 'Cantidad pagos', quantity: 0 },
        { item: 'Total pagos', total: 0 },
        { item: 'Dinero ingresado', total: 5000 },
        { item: 'Dinero devuelto', total: 0 },
        { item: 'Recaudo neto', total: 5000 },
      ],
    });
  });

  it('serializes concurrent closeout creation so a second call never reads a stale "last TOTAL" snapshot', async () => {
    const service = createService();
    const executionOrder: string[] = [];
    let resolveFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const serializedSpy = jest
      .spyOn(service as unknown as Record<string, (dto: unknown) => Promise<unknown>>, 'createCashCloseoutSerialized')
      .mockImplementationOnce(async (dto: unknown) => {
        executionOrder.push(`start-${(dto as { closedBy: string }).closedBy}`);
        await firstGate;
        executionOrder.push(`end-${(dto as { closedBy: string }).closedBy}`);
        return { id: 1 };
      })
      .mockImplementationOnce(async (dto: unknown) => {
        executionOrder.push(`start-${(dto as { closedBy: string }).closedBy}`);
        executionOrder.push(`end-${(dto as { closedBy: string }).closedBy}`);
        return { id: 2 };
      });

    const firstCall = service.createCashCloseout({ closedBy: 'operator-a', closeoutType: 'TOTAL' } as never);
    const secondCall = service.createCashCloseout({ closedBy: 'operator-b', closeoutType: 'TOTAL' } as never);

    // Deja correr microtasks: la segunda llamada NO debe haber arrancado todavia,
    // porque la primera sigue bloqueada en firstGate.
    await Promise.resolve();
    await Promise.resolve();
    expect(executionOrder).toEqual(['start-operator-a']);

    resolveFirst();
    await Promise.all([firstCall, secondCall]);

    expect(executionOrder).toEqual([
      'start-operator-a',
      'end-operator-a',
      'start-operator-b',
      'end-operator-b',
    ]);
    expect(serializedSpy).toHaveBeenCalledTimes(2);
  });
});
