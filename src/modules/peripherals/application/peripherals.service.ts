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

export interface ConfirmedReturnResult {
  confirmed: boolean;
  timedOut: boolean;
  total: number;
  frameBytes: [number, number, number, number];
  commandHex: string;
}

export interface EjectUnitsResult {
  requested: number;
  confirmedUnits: number;
  confirmed: boolean;
}

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
  // Cooldown por codigo: mientras el mismo QR siga frente al lector puede
  // emitir varias lecturas seguidas: se ignoran las repeticiones del mismo
  // codigo dentro de esta ventana para no disparar sesiones/validaciones duplicadas.
  private readonly qrDuplicateCooldownMs: number;
  private lastQrScan: QrScannedEvent | null = null;
  private lastAcceptedQrCode: string | null = null;
  private lastAcceptedQrAt = 0;
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
    this.qrDuplicateCooldownMs =
      this.configService.get<number>('peripherals.qrScannerDuplicateCooldownMs') ?? 4_000;

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

    const totalToReturn = this.sumItems(items);
    const frameBytes = this.toReturnFrame(slotConfig);

    this.electronicBoard.activate();
    await new Promise<void>((r) => setTimeout(r, 300));

    const commandBytes = this.electronicBoard.buildReturnRawCommand(frameBytes, totalToReturn);
    const commandHex = this.toHex(commandBytes);

    this.logger.log(
      `[RETURN] total=${totalToReturn} slots=[bill1=${bill1Den},bill2=${bill2Den},coin1=${coin1Den},coin2=${coin2Den}]` +
      ` frame=${JSON.stringify(frameBytes)} command=${commandHex}`,
    );

    this.electronicBoard.returnChange(totalToReturn, bill1Den, bill2Den, coin1Den, coin2Den);

    // Este metodo manda UN solo trama con el total — no hay ACK por denominacion
    // individual que confirmar (ver returnChangeConfirmed). Se descuenta
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
    await new Promise<void>((r) => setTimeout(r, this.dispenseWaitMs(items)));

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
   * Devolucion con confirmacion de la placa: UNA trama RETURN con las
   * denominaciones reales de los 4 slots (dispenser_slots) y el total a devolver,
   * igual que returnChange(), pero esperando el ACK de la placa. La placa decide
   * como repartir el total con lo que le decimos que hay en cada caja — por eso
   * nunca se le manda una denominacion que no corresponda a lo cargado.
   *
   * Nunca se reintenta: un ACK perdido no prueba que el dinero no haya salido, y
   * reenviar una trama de total podria devolverlo dos veces. Si no hay ACK
   * (timeout) se asume que probablemente si salio y se descuenta el inventario;
   * si la placa responde fallo explicito, o el puerto no esta abierto, no se
   * descuenta. En ambos casos el llamador recibe confirmed=false para alertar.
   */
  async returnChangeConfirmed(items: ReturnChangeItem[]): Promise<ConfirmedReturnResult> {
    const slotConfig = await this.dispenserSlotService.getSlotConfig();
    const frameBytes = this.toReturnFrame(slotConfig);
    const total = this.sumItems(items);

    if (items.length === 0 || total <= 0) {
      return { confirmed: true, timedOut: false, total: 0, frameBytes, commandHex: '' };
    }

    const commandHex = this.toHex(this.electronicBoard.buildReturnRawCommand(frameBytes, total));
    this.logger.log(
      `[RETURN][ACK] total=${total} slots=[bill1=${slotConfig.bill1 ?? 0},bill2=${slotConfig.bill2 ?? 0},` +
      `coin1=${slotConfig.coin1 ?? 0},coin2=${slotConfig.coin2 ?? 0}] command=${commandHex}`,
    );

    this.electronicBoard.activate();
    try {
      await new Promise<void>((r) => setTimeout(r, 300));

      const result = await this.electronicBoard.returnWithAck(frameBytes, total);

      if (result.success || result.timedOut) {
        for (const item of items) {
          try {
            await this.decrementSlotQuantity(item.slotKey, item.quantity);
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'Error desconocido';
            this.logger.error(
              `[RETURN][ACK] no se pudo descontar inventario de slot=${item.slotKey} ` +
              `cantidad=${item.quantity}: ${detail} — verificar en el proximo conteo fisico`,
            );
          }
        }
      }

      if (!result.success) {
        this.logger.warn(
          `[RETURN][ACK] la placa no confirmo la devolucion de $${total.toLocaleString('es-CO')} ` +
          `(timedOut=${result.timedOut})`,
        );
      } else {
        await new Promise<void>((r) => setTimeout(r, this.dispenseWaitMs(items)));
      }

      return { confirmed: result.success, timedOut: result.timedOut, total, frameBytes, commandHex };
    } finally {
      this.electronicBoard.deactivate();
    }
  }

  /**
   * Expulsion manual de unidades de un slot (boton "Expulsar" de la vista
   * Dispositivos). Se manda una trama completa POR UNIDAD con total = la
   * denominacion del slot: con un total mayor (ej. 5 x $100 = $500) la placa
   * podria repartirlo desde otra caja (1 moneda de $500), y la prueba dejaria de
   * apuntar al slot elegido. Se detiene en la primera unidad sin confirmar.
   */
  async ejectUnits(
    slotKey: ReturnChangeItem['slotKey'],
    denomination: number,
    quantity: number,
  ): Promise<EjectUnitsResult> {
    let confirmedUnits = 0;

    for (let unit = 0; unit < quantity; unit += 1) {
      const result = await this.returnChangeConfirmed([{ slotKey, denomination, quantity: 1 }]);
      if (!result.confirmed) {
        break;
      }
      confirmedUnits += 1;
    }

    return { requested: quantity, confirmedUnits, confirmed: confirmedUnits === quantity };
  }

  // bytes 4-7 del protocolo: denominacion real de cada slot / unidad de escala
  // (billetes /1000, monedas /10). Slot inactivo o sin denominacion = 0.
  private toReturnFrame(slotConfig: DispenserSlotConfig): [number, number, number, number] {
    return [
      (slotConfig.bill1 ?? 0) / 1000,
      (slotConfig.bill2 ?? 0) / 1000,
      (slotConfig.coin1 ?? 0) / 10,
      (slotConfig.coin2 ?? 0) / 10,
    ];
  }

  private sumItems(items: ReturnChangeItem[]): number {
    return items.reduce((sum, item) => sum + item.denomination * item.quantity, 0);
  }

  private dispenseWaitMs(items: ReturnChangeItem[]): number {
    const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
    const hasBills = items.some((i) => i.slotKey === 'bill1' || i.slotKey === 'bill2');
    return hasBills ? totalUnits * 2500 + 1000 : totalUnits * 800 + 500;
  }

  private toHex(bytes: number[]): string {
    return bytes.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join(' ');
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
      const now = Date.now();
      if (
        this.lastAcceptedQrCode === qrCode &&
        now - this.lastAcceptedQrAt < this.qrDuplicateCooldownMs
      ) {
        this.logger.debug(`QR ignorado por cooldown (mismo codigo hace <4s): ${qrCode}`);
        return;
      }
      this.lastAcceptedQrCode = qrCode;
      this.lastAcceptedQrAt = now;

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
