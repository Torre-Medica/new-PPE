import 'reflect-metadata';
import dataSource from '@src/modules/persistence/infrastructure/data-source';
import { CashCloseoutEntity } from '@modules/persistence/infrastructure/entities/cash-closeout.entity';
import { CashCloseoutLineEntity } from '@modules/persistence/infrastructure/entities/cash-closeout-line.entity';
import { DenominationEntity } from '@modules/persistence/infrastructure/entities/denomination.entity';

type SampleType = 'PARTIAL' | 'TOTAL';

function getSampleType(): SampleType {
  const arg = process.argv.find((item) => item.startsWith('--type=')) ?? '';
  const value = arg.split('=')[1]?.toUpperCase();
  return value === 'PARTIAL' ? 'PARTIAL' : 'TOTAL';
}

function createReceiptPayload(type: SampleType, now: Date) {
  const startedAt = new Date(now.getTime() - 23 * 60 * 60 * 1000);

  return {
    title: 'coins',
    subtitle: 'Cierre de ventas',
    machine: type === 'PARTIAL' ? 'PPE2' : 'PPE3',
    periodStartedAt: startedAt.toISOString(),
    periodEndedAt: now.toISOString(),
    sections: [
      {
        title: 'Transacciones',
        rows: [
          { item: 'Visitante Carro', quantity: 46, total: 466500 },
          { item: 'Visitante Moto', quantity: 92, total: 567300 },
          { item: 'Evento Carro', quantity: 0, total: 0 },
          { item: 'Evento Moto', quantity: 0, total: 0 },
          { item: 'Ticket Perdido', quantity: 0, total: 0 },
        ],
        total: 1033800,
      },
      {
        title: 'Dinero recibido',
        rows: [
          { item: 'Visitante Carro', total: 1034700 },
          { item: 'Visitante Moto', total: 1198100 },
        ],
        total: 2232800,
      },
      {
        title: 'Dinero devolucion',
        rows: [
          { item: 'Visitante Carro', total: 568200 },
          { item: 'Visitante Moto', total: 630800 },
        ],
        total: 1199000,
      },
      {
        title: 'Dinero en tolvas',
        rows: [
          { item: '$ 10.000', quantity: 72, total: 720000 },
          { item: '$ 2.000', quantity: 183, total: 366000 },
          { item: '$ 500', quantity: 361, total: 180500 },
          { item: '$ 100', quantity: 336, total: 33600 },
        ],
        total: 1300100,
      },
      {
        title: 'Codigos de descuento',
        rows: [
          { item: 'Codigo', quantity: '', total: 'Fecha' },
          { item: 'Prefijo 1035000 77', quantity: 1, total: '' },
        ],
      },
    ],
    footerLines: [
      `Total cobrado: $ ${(type === 'PARTIAL' ? 597900 : 6883550).toLocaleString('es-CO')}`,
      'COINS Tech',
    ],
  };
}

async function main() {
  const type = getSampleType();
  await dataSource.initialize();

  const closeoutRepo = dataSource.getRepository(CashCloseoutEntity);
  const lineRepo = dataSource.getRepository(CashCloseoutLineEntity);
  const denominationRepo = dataSource.getRepository(DenominationEntity);

  const now = new Date();
  const periodStartedAt = new Date(now.getTime() - 23 * 60 * 60 * 1000);
  const receiptPayload = createReceiptPayload(type, now);

  const closeout = await closeoutRepo.save(
    closeoutRepo.create({
      periodStartedAt,
      periodEndedAt: now,
      closedAt: now,
      closedBy: 'demo-closeout-script',
      closeoutType: type,
      transactionCount: 138,
      totalCollected: 1033800,
      notes: `Cierre de prueba ${type}`,
      receiptJson: JSON.stringify(receiptPayload),
    }),
  );

  const sampleLines = [
    { denominationId: 10000, quantity: 72, subtotal: 720000 },
    { denominationId: 2000, quantity: 183, subtotal: 366000 },
    { denominationId: 500, quantity: 361, subtotal: 180500 },
    { denominationId: 100, quantity: 336, subtotal: 33600 },
  ];

  for (const sampleLine of sampleLines) {
    const denomination = await denominationRepo.findOneBy({ id: sampleLine.denominationId });
    if (!denomination) {
      continue;
    }

    await lineRepo.save(
      lineRepo.create({
        closeoutId: closeout.id,
        denominationId: denomination.id,
        quantity: sampleLine.quantity,
        subtotal: sampleLine.subtotal,
      }),
    );
  }

  console.log(
    JSON.stringify(
      {
        id: closeout.id,
        type,
        message: 'Cierre de prueba creado. Ya puede imprimirlo desde el endpoint o frontend.',
      },
      null,
      2,
    ),
  );
  await dataSource.destroy();
}

void main();
