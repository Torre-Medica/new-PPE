import {
  Injectable,
  ServiceUnavailableException,
  BadRequestException,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter } from 'node:events';
import { EntityManager, Repository } from 'typeorm';
import { ConnectDeviceDto } from '@modules/peripherals/application/dto/connect-device.dto';
import { DispenserSlotService, DispenserSlotConfig } from '@modules/peripherals/application/dispenser-slot.service';
import { PrinterDetectorService } from '@modules/peripherals/application/printer-detector.service';
export interface ReturnChangeItem {
  slotKey: 'bill1' | 'bill2' | 'coin1' | 'coin2';
  denomination: number;
  quantity: number;
}

export interface ReturnCommandAudit {
  slotKey: ReturnChangeItem['slotKey'];
  requestedDenomination: number;
  quantity: number;
  frameBytes: [number, number, number, number];
  controlUnitValue: number;
  rawTotal: number;
  commandBytes: number[];
  commandHex: string;
}

export interface CollectorTestSample {
  amount: number;
  kind: 'BILL' | 'COIN';
  source: string;
  receivedAt: string;
}

export interface ReliableReturnChunk {
  slotKey: ReturnChangeItem['slotKey'];
  denomination: number;
  quantity: number;
  confirmed: boolean;
  timedOut: boolean;
}

export interface ReliableReturnResult {
  confirmedItems: ReliableReturnChunk[];
  unconfirmedItems: ReliableReturnChunk[];
}

type ReturnSlotKey = ReturnChangeItem['slotKey'];
import { RETURN_FRAME_BY_SLOT } from '@modules/peripherals/domain/electronic-board-frames';
import { BillAcceptorPort } from '@modules/peripherals/domain/ports/bill-acceptor.port';
import { ChangeDispenserPort } from '@modules/peripherals/domain/ports/change-dispenser.port';
import { QrScannerPort } from '@modules/peripherals/domain/ports/qr-scanner.port';
import { BillValidatorAdapter } from '@modules/peripherals/infrastructure/adapters/bill-validator.adapter';
import { ElectronicBoardAdapter } from '@modules/peripherals/infrastructure/adapters/electronic-board.adapter';
import { QrScannerAdapter } from '@modules/peripherals/infrastructure/adapters/qr-scanner.adapter';
import { SimulatedBillValidatorAdapter } from '@modules/peripherals/infrastructure/adapters/simulated-bill-validator.adapter';
import { SimulatedElectronicBoardAdapter } from '@modules/peripherals/infrastructure/adapters/simulated-electronic-board.adapter';
import { SimulatedQrScannerAdapter } from '@modules/peripherals/infrastructure/adapters/simulated-qr-scanner.adapter';
import { PortResolverService } from '@modules/peripherals/infrastructure/port-resolver.service';
import { MoneyReceivedEvent, PeripheralErrorEvent } from '@modules/peripherals/interfaces/money-events.interface';
import { QrScannedEvent } from '@modules/peripherals/interfaces/qr-events.interface';
import { DeviceHealthLogEntity } from '@modules/persistence/infrastructure/entities/device-health-log.entity';
import {
  DeviceEntity,
  DeviceStatus,
  DeviceType,
} from '@modules/persistence/infrastructure/entities/device.entity';
import { DispenserSlotEntity } from '@modules/persistence/infrastructure/entities/dispenser-slot.entity';

@Injectable()
export class PeripheralsService implements OnApplicationBootstrap {
  private static readonly COLLECTOR_TEST_BILL_DENOMINATIONS = [1000, 2000, 5000, 10000, 20000, 50000];
  private readonly logger = new Logger(PeripheralsService.name);
  private readonly emitter = new EventEmitter();
  private readonly billValidator: BillAcceptorPort;
  private readonly electronicBoard: ChangeDispenserPort;
  private readonly qrScanner: QrScannerPort;
  private lastQrScan: QrScannedEvent | null = null;
  private qrConnectedPort: string | null = null;
  private qrReconnectTimer: NodeJS.Timeout | null = null;
  private boardReconnectTimer: NodeJS.Timeout | null = null;
  private collectorTestModeEnabled = false;
  private collectorTestSamples: CollectorTestSample[] = [];

  constructor(
    @InjectRepository(DeviceEntity)
    private readonly deviceRepository: Repository<DeviceEntity>,
    @InjectRepository(DeviceHealthLogEntity)
    private readonly deviceHealthLogRepository: Repository<DeviceHealthLogEntity>,
    private readonly configService: ConfigService,
    private readonly dispenserSlotService: DispenserSlotService,
    private readonly portResolver: PortResolverService,
    private readonly printerDetector: PrinterDetectorService,
  ) {
    const billPath = this.configService.get<string>('peripherals.billValidatorLegacyPath') ?? '';
    const boardPath = this.configService.get<string>('peripherals.electronicBoardLegacyPath') ?? '';
    const qrBaudRate = this.configService.get<number>('peripherals.qrScannerBaudRate') ?? 115200;
    const simulateHardware = this.configService.get<boolean>('peripherals.simulateHardware', false);

    if (simulateHardware) {
      this.logger.warn('SIMULATE_HARDWARE activo: perifericos operaran en modo simulado (sin hardware fisico)');
    }

    this.billValidator = simulateHardware
      ? new SimulatedBillValidatorAdapter()
      : new BillValidatorAdapter(billPath);
    this.electronicBoard = simulateHardware
      ? new SimulatedElectronicBoardAdapter()
      : new ElectronicBoardAdapter(boardPath);
    // QrScanner necesita la lista de puertos excluidos para el autodetect;
    // se actualizara en onApplicationBootstrap tras resolver los puertos reales.
    this.qrScanner = simulateHardware
      ? new SimulatedQrScannerAdapter()
      : new QrScannerAdapter(qrBaudRate, []);
  }

  async onApplicationBootstrap(): Promise<void> {
    this.bindLegacyListeners();
    await this.logStartupDiagnostics();
    if (this.configService.get<boolean>('app.headlessMode', false)) {
      this.logger.warn('PPE headless mode activo: se omite la conexion automatica de perifericos fisicos');
      await this.logHealth('SYSTEM', 'info', 'Headless mode activo: perifericos omitidos en arranque');
      return;
    }
    await this.connectHardwareSilently();
    await this.ensureQrScannerListening();
    await this.printerDetector.detect();

    if (this.configService.get<boolean>('peripherals.simulateHardware', false)) {
      await this.markRemainingDevicesConnectedForSimulation();
    }
  }

  /**
   * En modo simulado, connectHardwareSilently() solo reporta CONNECTED para
   * los dispositivos con puerto/VID-PID resuelto (placa, QR). Los tipos que
   * no tienen configuracion propia en este PPE (billetero independiente,
   * canales logicos de moneda/cambio, slots de dispensador) se marcan aqui
   * para que toda la lista de /api/devices aparezca activa durante pruebas.
   */
  private async markRemainingDevicesConnectedForSimulation(): Promise<void> {
    const devices = await this.deviceRepository.find();
    const now = new Date();

    for (const device of devices) {
      if (device.status === DeviceStatus.Connected) {
        continue;
      }

      device.status = DeviceStatus.Connected;
      device.port = device.port ?? 'SIMULATED';
      device.lastError = null;
      device.lastHeartbeatAt = now;
    }

    await this.deviceRepository.save(devices);
    this.logger.log('[SIMULADO] Todos los perifericos marcados como CONECTADOS para pruebas');
  }

  async connectAll(): Promise<void> {
    this.logger.log('Iniciando conexion manual de perifericos del PPE');
    const billPort = await this.portResolver.resolve({
      vendorId: this.configService.get<string>('peripherals.billValidatorUsbVid'),
      productId: this.configService.get<string>('peripherals.billValidatorUsbPid'),
      fallbackPort: this.configService.get<string>('peripherals.billValidatorPort'),
      deviceName: 'Billetero',
    }) ?? '';
    const boardPort = await this.portResolver.resolve({
      vendorId: this.configService.get<string>('peripherals.electronicBoardUsbVid'),
      productId: this.configService.get<string>('peripherals.electronicBoardUsbPid'),
      fallbackPort: this.configService.get<string>('peripherals.electronicBoardPort'),
      deviceName: 'Placa electronica',
    }) ?? '';
    const qrPort = await this.resolveQrPort();
    this.logger.log(
      `Resumen de puertos resueltos | QR=${qrPort ?? 'no-resuelto'} | BILL=${billPort || 'no-resuelto'} | BOARD=${boardPort || 'no-resuelto'}`,
    );

    try {
      await this.updateDeviceState(DeviceType.BillValidator, DeviceStatus.Connecting, billPort || null);
      await this.updateDeviceState(DeviceType.ElectronicBoard, DeviceStatus.Connecting, boardPort || null);
      if (billPort) await this.billValidator.connect(billPort);
      if (billPort) await this.updateDeviceState(DeviceType.BillValidator, DeviceStatus.Connected, billPort);
      await this.electronicBoard.connect(boardPort);
      await this.updateDeviceState(DeviceType.ElectronicBoard, DeviceStatus.Connected, boardPort);
      this.ensureAcceptanceDisabled('connect-all');
      await this.connectQrScannerInternal(qrPort);
    } catch (error) {
      await this.logHealth(
        'SYSTEM',
        'error',
        error instanceof Error ? error.message : 'Error desconocido al conectar perifericos',
      );

      throw new ServiceUnavailableException({
        message: 'No fue posible conectar los perifericos',
        detail: error instanceof Error ? error.message : 'Error desconocido',
      });
    }

    await this.logSlotDiagnostics();
  }

  async connectDevice(dto: ConnectDeviceDto): Promise<void> {
    const billPort = await this.portResolver.resolve({
      vendorId: this.configService.get<string>('peripherals.billValidatorUsbVid'),
      productId: this.configService.get<string>('peripherals.billValidatorUsbPid'),
      fallbackPort: this.configService.get<string>('peripherals.billValidatorPort'),
      deviceName: 'Billetero',
    }) ?? '';
    const boardPort = await this.portResolver.resolve({
      vendorId: this.configService.get<string>('peripherals.electronicBoardUsbVid'),
      productId: this.configService.get<string>('peripherals.electronicBoardUsbPid'),
      fallbackPort: this.configService.get<string>('peripherals.electronicBoardPort'),
      deviceName: 'Placa electronica',
    }) ?? '';
    const qrPort = this.configService.get<string>('peripherals.qrScannerPort') ?? '';

    const configuredPort =
      dto.port ??
      (dto.type === DeviceType.BillValidator
        ? billPort
        : dto.type === DeviceType.QrScanner
          ? qrPort
          : boardPort);

    switch (dto.type) {
      case DeviceType.BillValidator:
        await this.updateDeviceState(dto.type, DeviceStatus.Connecting, configuredPort);
        await this.billValidator.connect(configuredPort);
        await this.updateDeviceState(dto.type, DeviceStatus.Connected, configuredPort);
        this.ensureAcceptanceDisabled('connect-device-bill-validator');
        break;
      case DeviceType.ElectronicBoard:
      case DeviceType.ChangeDispenser:
      case DeviceType.CoinAcceptor:
        await this.updateDeviceState(dto.type, DeviceStatus.Connecting, configuredPort);
        await this.electronicBoard.connect(configuredPort);
        await this.updateDeviceState(dto.type, DeviceStatus.Connected, configuredPort);
        this.ensureAcceptanceDisabled('connect-device-electronic-board');
        break;
      case DeviceType.QrScanner:
        await this.connectQrScannerInternal(configuredPort || undefined);
        break;
      default:
        throw new BadRequestException({
          message: 'Tipo de dispositivo no soportado para conexion activa',
          supported: [
            DeviceType.QrScanner,
            DeviceType.BillValidator,
            DeviceType.ElectronicBoard,
            DeviceType.ChangeDispenser,
            DeviceType.CoinAcceptor,
          ],
        });
    }
  }

  activateAcceptance(acceptedBillDenominations?: number[]): void {
    this.billValidator.activate(acceptedBillDenominations);
    this.electronicBoard.activate();
  }

  deactivateAcceptance(): void {
    this.billValidator.deactivate();
    this.electronicBoard.deactivate();
  }

  startCollectorTestMode(initiatedBy = 'admin'): { enabled: boolean; initiatedBy: string } {
    this.collectorTestModeEnabled = true;
    this.collectorTestSamples = [];
    this.activateAcceptance(PeripheralsService.COLLECTOR_TEST_BILL_DENOMINATIONS);
    this.logger.log(`[COLLECTOR][TEST] receptores activados por ${initiatedBy}`);
    return { enabled: true, initiatedBy };
  }

  stopCollectorTestMode(initiatedBy = 'admin'): { enabled: boolean; initiatedBy: string } {
    this.collectorTestModeEnabled = false;
    this.deactivateAcceptance();
    this.logger.log(`[COLLECTOR][TEST] receptores desactivados por ${initiatedBy}`);
    return { enabled: false, initiatedBy };
  }

  isCollectorTestModeEnabled(): boolean {
    return this.collectorTestModeEnabled;
  }

  recordCollectorTestSample(sample: CollectorTestSample): void {
    this.collectorTestSamples = [sample, ...this.collectorTestSamples].slice(0, 20);
  }

  getCollectorTestSnapshot(): { enabled: boolean; samples: CollectorTestSample[] } {
    return {
      enabled: this.collectorTestModeEnabled,
      samples: [...this.collectorTestSamples],
    };
  }

  getDispenserSlotConfig(): Promise<DispenserSlotConfig> {
    return this.dispenserSlotService.getSlotConfig();
  }

  getDispenserSlots(): Promise<DispenserSlotEntity[]> {
    return this.dispenserSlotService.getAll();
  }

  decrementSlotQuantity(
    slotKey: 'bill1' | 'bill2' | 'coin1' | 'coin2',
    quantity: number,
    manager?: EntityManager,
  ): Promise<void> {
    return this.dispenserSlotService.decrementSlotQuantity(slotKey, quantity, manager);
  }

  /**
   * Envía UN solo comando RETURN a la placa con las denominaciones reales de todos los slots
   * y el monto total. La placa calcula internamente cuántas unidades expulsar de cada slot.
   * El protocolo requiere que bytes 4-7 codifiquen la denominación real de cada slot
   * (bills/1000, coins/10), no valores arbitrarios por slot.
   *
   * IMPORTANTE (confirmado en campo el 2026-09-01): las 4 denominaciones se leen
   * SIEMPRE de dispenser_slots via getSlotConfig(), no solo de los slots presentes
   * en `items`. Se probo la alternativa (derivar denominaciones solo de `items` y
   * dejar en 0 los slots no usados) y esta placa/firmware especifica deja de
   * dispensar fisicamente en los canales bill2/coin1 cuando su byte de
   * denominacion llega en 0 — aunque el comando y el checksum sean validos.
   * Con las 4 denominaciones reales siempre presentes (como aqui), los 4 canales
   * dispensan correctamente. Nota: esto reintroduce una ventana teorica donde,
   * si un operador cambia la denominacion de un slot justo entre planChange() y
   * este envio, la placa podria recibir una denominacion distinta a la que el
   * plan calculo — se acepta ese riesgo (muy improbable, ventana de milisegundos)
   * a cambio de que el dispensado fisico funcione de forma confiable.
   */
  async returnChange(items: ReturnChangeItem[]): Promise<ReturnCommandAudit[]> {
    if (items.length === 0) return [];

    const slotConfig = await this.dispenserSlotService.getSlotConfig();

    const bill1Den = slotConfig.bill1 ?? 0;
    const bill2Den = slotConfig.bill2 ?? 0;
    const coin1Den = slotConfig.coin1 ?? 0;
    const coin2Den = slotConfig.coin2 ?? 0;

    const totalToReturn = items.reduce(
      (sum, item) => sum + item.denomination * item.quantity,
      0,
    );

    // bytes 4-7 del protocolo: denominación del slot / unidad de escala
    const frameBytes: [number, number, number, number] = [
      bill1Den / 1000,
      bill2Den / 1000,
      coin1Den / 10,
      coin2Den / 10,
    ];

    this.electronicBoard.activate();
    await new Promise<void>((r) => setTimeout(r, 300));

    const commandBytes = this.electronicBoard.buildReturnRawCommand(frameBytes, totalToReturn);
    const commandHex = commandBytes
      .map((v) => v.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');

    this.logger.log(
      `[RETURN] total=${totalToReturn} slots=[bill1=${bill1Den},bill2=${bill2Den},coin1=${coin1Den},coin2=${coin2Den}]` +
      ` frame=${JSON.stringify(frameBytes)} command=${commandHex}`,
    );

    this.electronicBoard.returnChange(totalToReturn, bill1Den, bill2Den, coin1Den, coin2Den);

    // Este metodo manda UN solo trama con el total — no hay ACK por denominacion
    // individual que confirmar (a diferencia de returnChangeReliable). Se descuenta
    // el inventario de cada slot de una vez, confiando en que la placa reparte el
    // total como se le indico. El numero que realmente importa para el cuadre de
    // caja es el total de dinero en tolvas (ver changeInventoryTotal en el
    // dashboard y en el recibo de cierre) — el desglose por slot queda como dato
    // referencial para diagnostico, ajustado por el operador en cada cierre
    // parcial/total contra el conteo fisico real.
    for (const item of items) {
      try {
        await this.decrementSlotQuantity(item.slotKey, item.quantity);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Error desconocido';
        this.logger.error(
          `[RETURN] no se pudo descontar inventario de slot=${item.slotKey} ` +
          `cantidad=${item.quantity}: ${detail}`,
        );
      }
    }

    // Espera proporcional al número de unidades físicas a dispensar
    const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
    const hasBills = items.some((i) => i.slotKey === 'bill1' || i.slotKey === 'bill2');
    const waitMs = hasBills
      ? totalUnits * 2500 + 1000
      : totalUnits * 800 + 500;

    await new Promise<void>((r) => setTimeout(r, waitMs));

    // Desactivar la placa después de dispensar — nunca debe quedar activa sin sesión
    this.electronicBoard.deactivate();

    return items.map((item) => ({
      slotKey: item.slotKey,
      requestedDenomination: item.denomination,
      quantity: item.quantity,
      frameBytes,
      controlUnitValue: item.denomination,
      rawTotal: totalToReturn,
      commandBytes,
      commandHex,
    }));
  }

  /**
   * Devolucion confiable: una trama RETURN aislada por denominacion (tabla fija de
   * docs/TRAMAS_DEVOLUCION_PLACA.md), en orden secuencial, esperando siempre la
   * confirmacion (ACK) de la placa antes de mandar la siguiente. Mas lenta que
   * returnChange(), pero elimina la ambiguedad de que canal fisico uso la placa para
   * repartir un total mezclado.
   *
   * El propio docs/TRAMAS_DEVOLUCION_PLACA.md admite que "el ACK no garantiza por si
   * solo la expulsion fisica" — es decir, la ausencia de ACK no prueba que la moneda
   * no haya salido. Por eso un ACK perdido AISLADO no debe dejar al cliente sin el
   * resto del cambio: se reintenta una vez, y si sigue sin confirmar se asume que
   * probablemente si se expulso (se descuenta el inventario igual) y se registra
   * como incidente para revision manual, mientras la secuencia continua con el
   * resto de las denominaciones. Solo se corta la secuencia completa ante fallos
   * consecutivos, que si son una señal real de que la placa dejo de responder.
   */
  async returnChangeReliable(items: ReturnChangeItem[]): Promise<ReliableReturnResult> {
    if (items.length === 0) return { confirmedItems: [], unconfirmedItems: [] };

    const chunks: ReliableReturnChunk[] = [];
    for (const item of items) {
      const spec = RETURN_FRAME_BY_SLOT[item.slotKey];
      let remaining = item.quantity;
      while (remaining > 0) {
        const quantity = Math.min(remaining, spec.maxUnitsPerOrder);
        chunks.push({
          slotKey: item.slotKey,
          denomination: item.denomination,
          quantity,
          confirmed: false,
          timedOut: false,
        });
        remaining -= quantity;
      }
    }

    const confirmedItems: ReliableReturnChunk[] = [];
    const unconfirmedItems: ReliableReturnChunk[] = [];

    // Todo el ciclo de activate()/deactivate() va en try/finally: si CUALQUIER
    // cosa lanza aqui adentro (incluyendo un fallo de decrementSlotQuantity por
    // inventario insuficiente — una condicion real y esperable, no un error de
    // hardware), la placa NO debe quedar armada indefinidamente. Antes, una
    // excepcion a mitad del ciclo saltaba directo por encima de deactivate().
    this.electronicBoard.activate();
    try {
      await new Promise<void>((r) => setTimeout(r, 300));

      const MAX_CONSECUTIVE_FAILURES = 2;
      let consecutiveFailures = 0;
      let stopped = false;

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        if (stopped) {
          unconfirmedItems.push(chunk);
          continue;
        }

        this.logger.log(
          `[RETURN][RELIABLE] slot=${chunk.slotKey} denominacion=${chunk.denomination} cantidad=${chunk.quantity}`,
        );

        let result = await this.electronicBoard.dispenseUnits(chunk.slotKey, chunk.quantity);

        if (!result.success) {
          this.logger.warn(
            `[RETURN][RELIABLE] sin confirmacion en primer intento — slot=${chunk.slotKey} ` +
            `cantidad=${chunk.quantity} timedOut=${result.timedOut} — reintentando una vez`,
          );

          // El protocolo de la placa no incluye ningun identificador en el ACK —
          // es solo un si/no, sin decir a que comando responde. Si el timeout se
          // debio a que la placa era simplemente lenta (no que dejo de
          // responder), su ACK real podria llegar tarde, DESPUES de que ya
          // registramos el resolver del reintento — y quedaria atribuido al
          // comando equivocado. Esta pausa le da tiempo a un ACK tardio de
          // "drenar" mientras no hay ningun resolver pendiente al que pegarle.
          await new Promise<void>((r) => setTimeout(r, 500));

          result = await this.electronicBoard.dispenseUnits(chunk.slotKey, chunk.quantity);
        }

        // El descuento de inventario puede fallar por una razon de negocio real
        // (otra operacion concurrente — carga/descarga manual, otro chunk — ya
        // dejo el slot sin unidades suficientes), no solo por un problema de
        // hardware. Se aisla en su propio try/catch: si falla, se registra como
        // incidente y se continua con el resto del cambio en vez de abortar
        // todo el ciclo (y dejar la placa sin desactivar) por una condicion que
        // ya deberiamos poder anticipar y manejar con gracia.
        let decremented = false;
        try {
          await this.decrementSlotQuantity(chunk.slotKey, chunk.quantity);
          decremented = true;
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Error desconocido';
          this.logger.error(
            `[RETURN][RELIABLE] no se pudo descontar inventario de slot=${chunk.slotKey} ` +
            `cantidad=${chunk.quantity}: ${detail} — se registra como incidente y se continua`,
          );
        }

        if (result.success) {
          chunk.confirmed = true;
          consecutiveFailures = 0;
          confirmedItems.push(chunk);

          // Hipotesis en prueba: el mecanismo de billetes (bill1/bill2 comparten
          // el mismo motor/presentador fisico) podria no aceptar una orden nueva
          // mientras el mecanismo todavia esta asentando la anterior — la placa
          // ACKea "exito" igual, pero el billete no llega a salir. Las monedas
          // usan un mecanismo distinto e independiente, donde esto nunca se ha
          // observado. Por eso el piso de 4s aplica a CUALQUIER transicion que
          // involucre un billete de un lado o del otro (moneda->billete,
          // billete->moneda, billete->billete); moneda->moneda no lo necesita y
          // se deja con su espera de asentamiento original.
          //
          // Nota: esto no cubre el caso de un billete fallando como PRIMER y
          // UNICO comando de toda la secuencia (sin nada antes) — ahi no hay
          // transicion previa a la que ponerle margen, asi que si la falla
          // persiste en ese escenario especifico apunta a algo mecanico, no de
          // tiempos.
          const isBill = chunk.slotKey === 'bill1' || chunk.slotKey === 'bill2';
          const nextChunk = chunks[chunkIndex + 1];
          const nextIsBill =
            !!nextChunk && (nextChunk.slotKey === 'bill1' || nextChunk.slotKey === 'bill2');

          let waitMs: number;
          if (isBill || nextIsBill) {
            waitMs = Math.max(4000, isBill ? chunk.quantity * 2500 : 0);
          } else {
            waitMs = chunk.quantity * 800;
          }
          await new Promise<void>((r) => setTimeout(r, waitMs));
        } else {
          chunk.timedOut = result.timedOut;
          consecutiveFailures += 1;
          unconfirmedItems.push(chunk);

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            this.logger.error(
              `[RETURN][RELIABLE] ${consecutiveFailures} fallos de confirmacion consecutivos — ` +
              `se detiene la secuencia, la placa probablemente dejo de responder`,
            );
            stopped = true;
          } else {
            this.logger.warn(
              `[RETURN][RELIABLE] sin confirmacion tras reintento — slot=${chunk.slotKey} ` +
              `cantidad=${chunk.quantity} — continuando con el resto del cambio`,
            );
            // Mismo colchon que en el reintento: si vamos a mandar el siguiente
            // chunk, dejamos que un ACK tardio de este ya drene primero.
            await new Promise<void>((r) => setTimeout(r, 500));
          }
        }

        if (!decremented) {
          // El chunk ya quedo clasificado en confirmedItems/unconfirmedItems segun
          // la confirmacion de hardware (arriba) — eso es lo que le importa al
          // llamador para saber si el cliente recibio su dinero. El fallo de
          // inventario ya quedo registrado en el log de error de arriba para
          // revision manual, sin reclasificar ni duplicar el chunk entre listas.
          this.logger.warn(
            `[RETURN][RELIABLE] slot=${chunk.slotKey} quedo con inventario desincronizado ` +
            `tras este chunk — verificar en el proximo conteo fisico`,
          );
        }
      }
    } finally {
      this.electronicBoard.deactivate();
    }

    return { confirmedItems, unconfirmedItems };
  }

  async disconnectAll(): Promise<void> {
    if (this.qrReconnectTimer) {
      clearTimeout(this.qrReconnectTimer);
      this.qrReconnectTimer = null;
    }

    if (this.boardReconnectTimer) {
      clearTimeout(this.boardReconnectTimer);
      this.boardReconnectTimer = null;
    }

    this.billValidator.disconnect();
    this.electronicBoard.disconnect();
    await this.qrScanner.disconnect();
    const prevPort = this.qrConnectedPort;
    this.qrConnectedPort = null;
    await this.logHealth('QR_SCANNER', 'info', `Lector QR desconectado${prevPort ? ` de ${prevPort}` : ''}`);
    await this.updateDeviceState(DeviceType.BillValidator, DeviceStatus.Disconnected, null);
    await this.updateDeviceState(DeviceType.QrScanner, DeviceStatus.Disconnected, null);
    await this.updateDeviceState(DeviceType.ElectronicBoard, DeviceStatus.Disconnected, null);
    await this.updateDeviceState(DeviceType.CoinAcceptor, DeviceStatus.Disconnected, null);
    await this.updateDeviceState(DeviceType.ChangeDispenser, DeviceStatus.Disconnected, null);
    this.logger.log('Todos los perifericos quedaron marcados como desconectados');
  }

  onMoneyReceived(handler: (event: MoneyReceivedEvent) => void): void {
    this.emitter.on('money.received', handler);
  }

  onPeripheralError(handler: (event: PeripheralErrorEvent) => void): void {
    this.emitter.on('device.error', handler);
  }

  onQrScanned(handler: (event: QrScannedEvent) => void): void {
    this.emitter.on('qr.scanned', handler);
  }

  getLastQrScan(): QrScannedEvent | null {
    return this.lastQrScan;
  }

  private bindLegacyListeners(): void {
    this.billValidator.onBillReceived((amount) => {
      this.logger.log(`[COLLECTOR][BILL] ${amount}`);
      this.emitter.emit('money.received', {
        source: 'BILL_VALIDATOR',
        amount: Number(amount),
      } satisfies MoneyReceivedEvent);
    });

    this.electronicBoard.onCoinReceived((amount) => {
      this.logger.log(`[COLLECTOR][COIN] ${amount}`);
      this.emitter.emit('money.received', {
        source: 'ELECTRONIC_BOARD_COIN',
        amount: Number(amount),
      } satisfies MoneyReceivedEvent);
    });

    this.electronicBoard.onBillReceived((amount) => {
      this.logger.log(`[COLLECTOR][BILL] ${amount}`);
      this.emitter.emit('money.received', {
        source: 'ELECTRONIC_BOARD_BILL',
        amount: Number(amount),
      } satisfies MoneyReceivedEvent);
    });

    this.billValidator.onError((message) => {
      this.emitter.emit('device.error', {
        source: 'BILL_VALIDATOR',
        message,
      } satisfies PeripheralErrorEvent);
      void this.updateDeviceState(DeviceType.BillValidator, DeviceStatus.Error, null, message);
      void this.logHealth('BILL_VALIDATOR', 'error', message);
    });

    this.electronicBoard.onError((message) => {
      this.logger.warn(`Placa electronica desconectada o con error — ${message}`);
      this.emitter.emit('device.error', {
        source: 'ELECTRONIC_BOARD',
        message,
      } satisfies PeripheralErrorEvent);
      void this.updateDeviceState(DeviceType.ElectronicBoard, DeviceStatus.Disconnected, null, message);
      void this.logHealth('ELECTRONIC_BOARD', 'error', message);
      this.scheduleBoardReconnect();
    });

    this.qrScanner.onQrCode((qrCode, rawCode) => {
      const qrEvent = {
        source: 'QR_SCANNER',
        qrCode,
        rawCode,
        port: this.qrConnectedPort,
        scannedAt: new Date().toISOString(),
      } satisfies QrScannedEvent;

      this.lastQrScan = qrEvent;
      this.logger.log(
        `QR leido correctamente | port=${this.qrConnectedPort ?? 'puerto-desconocido'} | qr=${qrCode}`,
      );
      void this.logHealth('QR_SCANNER', 'info', `QR leido: ${qrCode.slice(0, 48)}`);
      this.emitter.emit('qr.scanned', qrEvent);
    });

    this.qrScanner.onInvalidQr((rawCode, reason) => {
      const rawPreview = rawCode.trim().slice(0, 120);
      this.logger.warn(
        `Lectura QR invalida desde ${this.qrConnectedPort ?? 'puerto-desconocido'}: ${reason}. Raw=${rawPreview}`,
      );
      void this.logHealth(
        'QR_SCANNER',
        'warning',
        `Lectura QR invalida: ${reason}. Raw=${rawPreview}`,
      );
    });

    this.qrScanner.onError((message) => {
      const prevPort = this.qrConnectedPort;
      this.qrConnectedPort = null;

      const isDisconnect = message.includes('cerro') || message.toLowerCase().includes('close');
      if (isDisconnect) {
        this.logger.warn(
          `Lector QR desconectado de ${prevPort ?? 'puerto desconocido'} — reintentando en 10 s`,
        );
      } else {
        this.logger.warn(
          `Lector QR reporto error en ${prevPort ?? 'puerto desconocido'}: ${message} — reintentando en 10 s`,
        );
      }

      this.emitter.emit('device.error', {
        source: 'QR_SCANNER',
        message,
      } satisfies PeripheralErrorEvent);
      void this.updateDeviceState(DeviceType.QrScanner, DeviceStatus.Disconnected, null, message);
      void this.logHealth('QR_SCANNER', 'error', message);
      this.scheduleQrReconnect(message);
    });
  }

  private async connectHardwareSilently(): Promise<void> {
    // ── Placa electrónica ──────────────────────────────────────────────────────
    const boardPort = await this.portResolver.resolve({
      vendorId: this.configService.get<string>('peripherals.electronicBoardUsbVid'),
      productId: this.configService.get<string>('peripherals.electronicBoardUsbPid'),
      fallbackPort: this.configService.get<string>('peripherals.electronicBoardPort'),
      deviceName: 'Placa electronica',
      deviceCode: 'ELECTRONIC_BOARD',
    });

    if (boardPort) {
      this.logger.log(`Conectando placa electronica en ${boardPort}...`);
      try {
        await this.updateDeviceState(DeviceType.ElectronicBoard, DeviceStatus.Connecting, boardPort);
        await this.electronicBoard.connect(boardPort);
        await this.updateDeviceState(DeviceType.ElectronicBoard, DeviceStatus.Connected, boardPort);
        await this.logHealth('ELECTRONIC_BOARD', 'info', `Placa electronica conectada en ${boardPort}`);
        this.logger.log(`Placa electronica conectada en ${boardPort}`);
        this.ensureAcceptanceDisabled('bootstrap-board-connect');
        for (const code of ['DISPENSER_BILL_1','DISPENSER_BILL_2','DISPENSER_COIN_1','DISPENSER_COIN_2']) {
          await this.deviceRepository.update({ code }, { port: boardPort });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido';
        await this.updateDeviceState(DeviceType.ElectronicBoard, DeviceStatus.Disconnected, boardPort, msg);
        await this.logHealth('ELECTRONIC_BOARD', 'warning', `No fue posible conectar placa electronica: ${msg}`);
        this.logger.warn(`No fue posible conectar la placa electronica en ${boardPort}: ${msg}`);
        this.scheduleBoardReconnect();
      }
    } else {
      this.logger.warn('Placa electronica omitida — ELECTRONIC_BOARD_PORT y USB VID/PID sin configurar');
    }

    // ── Billetero independiente (opcional) ────────────────────────────────────
    const billPort = await this.portResolver.resolve({
      vendorId: this.configService.get<string>('peripherals.billValidatorUsbVid'),
      productId: this.configService.get<string>('peripherals.billValidatorUsbPid'),
      fallbackPort: this.configService.get<string>('peripherals.billValidatorPort'),
      deviceName: 'Billetero',
      deviceCode: 'BILL_VALIDATOR',
    });

    if (billPort) {
      try {
        await this.updateDeviceState(DeviceType.BillValidator, DeviceStatus.Connecting, billPort);
        await this.billValidator.connect(billPort);
        await this.updateDeviceState(DeviceType.BillValidator, DeviceStatus.Connected, billPort);
        await this.logHealth('BILL_VALIDATOR', 'info', `Billetero conectado en ${billPort}`);
        this.logger.log(`Billetero conectado en ${billPort}`);
        this.ensureAcceptanceDisabled('bootstrap-bill-validator-connect');
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Error desconocido';
        await this.updateDeviceState(DeviceType.BillValidator, DeviceStatus.Disconnected, billPort, msg);
        await this.logHealth('BILL_VALIDATOR', 'warning', `No fue posible conectar billetero: ${msg}`);
        this.logger.warn(`No fue posible conectar el billetero en ${billPort}: ${msg}`);
      }
    } else {
      this.logger.log('Billetero omitido — sin VID/PID ni puerto configurado');
    }

    await this.logSlotDiagnostics();
  }

  private async connectQrScannerInternal(preferredPort?: string): Promise<void> {
    this.logger.log(
      preferredPort
        ? `Intentando conectar lector QR en ${preferredPort}`
        : 'Intentando autodetectar y conectar lector QR',
    );

    await this.updateDeviceState(
      DeviceType.QrScanner,
      DeviceStatus.Connecting,
      preferredPort ?? null,
    );

    try {
      const connectedPort = await this.qrScanner.connect(preferredPort);
      this.qrConnectedPort = connectedPort;
      this.lastQrScan = this.lastQrScan ? { ...this.lastQrScan, port: connectedPort } : null;
      await this.updateDeviceState(DeviceType.QrScanner, DeviceStatus.Connected, connectedPort);
      await this.logHealth('QR_SCANNER', 'info', `Lector QR conectado en ${connectedPort}`);
      this.logger.log(`Lector QR conectado en ${connectedPort}`);
    } catch (error) {
      this.qrConnectedPort = null;
      const detail =
        error instanceof Error ? error.message : 'No fue posible conectar el lector QR';

      await this.updateDeviceState(
        DeviceType.QrScanner,
        DeviceStatus.Disconnected,
        preferredPort ?? null,
        detail,
      );
      await this.logHealth(
        'QR_SCANNER',
        'warning',
        detail,
      );
      this.logger.warn(`No fue posible conectar el lector QR: ${detail}`);
      throw error;
    }
  }

  private async resolveQrPort(): Promise<string | undefined> {
    const resolved = await this.portResolver.resolve({
      vendorId: this.configService.get<string>('peripherals.qrScannerUsbVid'),
      productId: this.configService.get<string>('peripherals.qrScannerUsbPid'),
      fallbackPort: this.configService.get<string>('peripherals.qrScannerPort'),
      deviceName: 'Lector QR',
      deviceCode: 'QR_SCANNER',
    });
    return resolved ?? undefined;
  }

  private ensureAcceptanceDisabled(context: string): void {
    const retryDelaysMs = [0, 300, 1000, 2000];

    try {
      for (const delayMs of retryDelaysMs) {
        setTimeout(() => {
          try {
            this.deactivateAcceptance();
            this.logger.log(
              `Aceptacion de efectivo forzada a OFF tras ${context}${delayMs > 0 ? ` (+${delayMs}ms)` : ''}`,
            );
          } catch (error) {
            const detail =
              error instanceof Error ? error.message : 'Error desconocido al desactivar aceptacion';
            this.logger.warn(
              `No fue posible forzar aceptacion OFF tras ${context}${delayMs > 0 ? ` (+${delayMs}ms)` : ''}: ${detail}`,
            );
          }
        }, delayMs);
      }
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'Error desconocido al desactivar aceptacion';
      this.logger.warn(`No fue posible forzar aceptacion OFF tras ${context}: ${detail}`);
    }
  }

  private async ensureQrScannerListening(): Promise<void> {
    const qrPort = await this.resolveQrPort();
    try {
      await this.connectQrScannerInternal(qrPort);
    } catch (error) {
      this.scheduleQrReconnect(
        error instanceof Error ? error.message : 'Error desconocido al iniciar lector QR',
      );
    }
  }

  private async logStartupDiagnostics(): Promise<void> {
    await this.logSerialPortsSnapshot();
    await this.logSlotDiagnostics();
  }

  private async logSerialPortsSnapshot(): Promise<void> {
    try {
      const ports = await this.portResolver.listAll();
      if (!ports.length) {
        this.logger.warn('Diagnostico serial: no se detectaron puertos seriales disponibles');
        return;
      }

      this.logger.log(`Diagnostico serial: ${ports.length} puerto(s) detectado(s)`);
      for (const port of ports) {
        this.logger.log(
          `Puerto serial | path=${port.path} | vid=${port.vendorId ?? '-'} | pid=${port.productId ?? '-'} | fabricante=${port.manufacturer ?? '-'} | pnp=${port.pnpId ?? '-'}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `No fue posible listar puertos seriales: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async logSlotDiagnostics(): Promise<void> {
    // Diagnostico de slots omitido del log de terminal — consultable via GET /api/devices o DB
  }

  private scheduleQrReconnect(reason?: string): void {
    if (this.qrReconnectTimer) {
      return;
    }

    const detail = reason ? `: ${reason}` : '';
    this.logger.warn(`Sin conexion con lector QR — reintentando en 10 s${detail}`);
    void this.logHealth(
      'QR_SCANNER',
      'info',
      `Reconexion de lector QR programada en 10 s${detail}`,
    );

    this.qrReconnectTimer = setTimeout(() => {
      this.qrReconnectTimer = null;
      this.logger.log('Intentando reconectar lector QR...');
      void this.ensureQrScannerListening();
    }, 10_000);
  }

  private scheduleBoardReconnect(): void {
    if (this.boardReconnectTimer) {
      return;
    }

    this.logger.warn('Sin conexion con placa electronica — reintentando en 10 s');
    void this.logHealth(
      'ELECTRONIC_BOARD',
      'info',
      'Reconexion de placa electronica programada en 10 s',
    );

    this.boardReconnectTimer = setTimeout(() => {
      this.boardReconnectTimer = null;
      void this.retryBoardConnect();
    }, 10_000);
  }

  private async retryBoardConnect(): Promise<void> {
    const boardPort = await this.portResolver.resolve({
      vendorId: this.configService.get<string>('peripherals.electronicBoardUsbVid'),
      productId: this.configService.get<string>('peripherals.electronicBoardUsbPid'),
      fallbackPort: this.configService.get<string>('peripherals.electronicBoardPort'),
      deviceName: 'Placa electronica',
      deviceCode: 'ELECTRONIC_BOARD',
    });

    if (!boardPort) {
      this.logger.warn('Placa electronica: puerto no encontrado — reintentando en 10 s');
      this.scheduleBoardReconnect();
      return;
    }

    this.logger.log(`Intentando reconectar placa electronica en ${boardPort}...`);

    try {
      await this.updateDeviceState(DeviceType.ElectronicBoard, DeviceStatus.Connecting, boardPort);
      await this.electronicBoard.connect(boardPort);
      await this.updateDeviceState(DeviceType.ElectronicBoard, DeviceStatus.Connected, boardPort);
      await this.logHealth('ELECTRONIC_BOARD', 'info', `Placa electronica reconectada en ${boardPort}`);
      this.logger.log(`Placa electronica reconectada en ${boardPort}`);
      for (const code of ['DISPENSER_BILL_1','DISPENSER_BILL_2','DISPENSER_COIN_1','DISPENSER_COIN_2']) {
        await this.deviceRepository.update({ code }, { port: boardPort });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error desconocido';
      await this.updateDeviceState(DeviceType.ElectronicBoard, DeviceStatus.Disconnected, boardPort, msg);
      await this.logHealth('ELECTRONIC_BOARD', 'warning', `Reconexion de placa fallida: ${msg}`);
      this.logger.warn(`No fue posible reconectar la placa electronica en ${boardPort}: ${msg}`);
      this.scheduleBoardReconnect();
    }
  }

  private async updateDeviceState(
    type: DeviceType,
    status: DeviceStatus,
    port: string | null,
    lastError: string | null = null,
  ): Promise<void> {
    const device = await this.deviceRepository.findOne({ where: { type } });
    if (!device) {
      return;
    }

    device.status = status;
    device.port = port;
    device.lastError = lastError;
    device.lastHeartbeatAt = new Date();
    await this.deviceRepository.save(device);
  }

  private async logHealth(
    deviceCode: string,
    level: string,
    message: string,
  ): Promise<void> {
    const device = await this.deviceRepository.findOne({ where: { code: deviceCode } });
    const log = this.deviceHealthLogRepository.create({
      deviceCode,
      deviceId: device?.id ?? null,
      level,
      message,
    });
    await this.deviceHealthLogRepository.save(log);
  }
}
