"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillValidator = void 0;
const { SerialPort } = require("serialport");
const typed_event_emitter_1 = require("typed-event-emitter");
const { ReadlineParser } = require('@serialport/parser-readline');
class BillValidator extends typed_event_emitter_1.EventEmitter {
    constructor() {
        super();
        this.onBillReceived = this.registerEvent();
        this.onBillPending = this.registerEvent();
        this.onBillReturned = this.registerEvent();
        this.onData = this.registerEvent();
        this.onError = this.registerEvent();
    }
    connect(port) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("Conectando el validador de billetes");
            this.port = new SerialPort({
                path: port,
                baudRate: 9600
            }, (error) => {
                if (error) {
                    throw new Error("Error conectando el validador de billetes: " + error.message);
                }
                return false;
            });
            const dataAdapter = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
            dataAdapter.on("data", (data) => {
                if (data.includes("30 09")) {
                    return;
                }
                if (data.includes("30 80 09")) {
                    this.emit(this.onBillReceived, "1000");
                }
                else if (data.includes("30 81 09")) {
                    this.emit(this.onBillReceived, "2000");
                }
                else if (data.includes("30 82 09")) {
                    this.emit(this.onBillReceived, "5000");
                }
                else if (data.includes("30 83 09")) {
                    this.emit(this.onBillReceived, "10000");
                }
                else if (data.includes("30 84 09")) {
                    this.emit(this.onBillReceived, "20000");
                }
                else if (data.includes("30 85 09")) {
                    this.emit(this.onBillReceived, "50000");
                }
                else if (data.includes("30 86 09")) {
                    this.emit(this.onBillReceived, "100000");
                }
                else if (data.includes("30 90 09")) {
                    this.emit(this.onBillPending, "1000");
                }
                else if (data.includes("30 91 09")) {
                    this.emit(this.onBillPending, "2000");
                }
                else if (data.includes("30 92 09")) {
                    this.emit(this.onBillPending, "5000");
                }
                else if (data.includes("30 93 09")) {
                    this.emit(this.onBillPending, "10000");
                }
                else if (data.includes("30 94 09")) {
                    this.emit(this.onBillPending, "20000");
                }
                else if (data.includes("30 95 09")) {
                    this.emit(this.onBillPending, "50000");
                }
                else if (data.includes("30 96 09")) {
                    this.emit(this.onBillPending, "100000");
                }
                else if (data.includes("30 C0 09")) {
                    this.emit(this.onBillReturned, "1000");
                }
                else if (data.includes("30 C1 09")) {
                    this.emit(this.onBillReturned, "2000");
                }
                else if (data.includes("30 C2 09")) {
                    this.emit(this.onBillReturned, "5000");
                }
                else if (data.includes("30 C3 09")) {
                    this.emit(this.onBillReturned, "10000");
                }
                else if (data.includes("30 C4 09")) {
                    this.emit(this.onBillReturned, "20000");
                }
                else if (data.includes("30 C5 09")) {
                    this.emit(this.onBillReturned, "50000");
                }
                else if (data.includes("30 C6 09")) {
                    this.emit(this.onBillReturned, "100000");
                }
                else {
                    this.emit(this.onData, data);
                }
            });
            this.port.on('error', (error) => {
                this.emit(this.onError, "Ha ocurrido un error con el puerto del validador de billetes: " + error);
            });
            this.port.on('close', (error) => {
                this.emit(this.onError, "Se ha cerrado el puerto del validador de billetes: " + error);
            });
            this.port.on('disconnect', (error) => {
                this.emit(this.onError, "Se ha desconectado el puerto del validador de billetes: " + error);
            });
            return true;
        });
    }
    disconnect() {
        var _a;
        if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
            this.port.close((error) => {
                if (error) {
                    throw new Error("Error desconectando el validador de billetes: " + error.message);
                }
                return false;
            });
        }
        return true;
    }
    resetCommand() {
        var _a, _b;
        console.log("Bill validator - Sending reset command...");
        if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
            let command = BillValidator.RESET_COMMAND;
            (_b = this.port) === null || _b === void 0 ? void 0 : _b.write(command);
            return true;
        }
        else {
            throw new Error("El validador de billetes no está conectado");
        }
    }
    setupCommand() {
        var _a, _b;
        console.log("Bill validator - Sending setup command...");
        if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
            let command = BillValidator.SETUP_COMMAND;
            (_b = this.port) === null || _b === void 0 ? void 0 : _b.write(command);
            return true;
        }
        else {
            throw new Error("El validador de billetes no está conectado");
        }
    }
    securityCommand(securityLevel) {
        var _a, _b;
        console.log("Bill validator - Sending security command...");
        if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
            let command = BillValidator.SECURITY_COMMAND;
            command[1] = (Number(securityLevel) >> 8) & 0xff;
            command[2] = (Number(securityLevel) >> 0) & 0xff;
            (_b = this.port) === null || _b === void 0 ? void 0 : _b.write(command);
            return true;
        }
        else {
            throw new Error("El validador de billetes no está conectado");
        }
    }
    pollCommand() {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            console.log("Bill validator - Sending poll command...");
            if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
                let command = BillValidator.POLL_COMMAND;
                (_b = this.port) === null || _b === void 0 ? void 0 : _b.write(command);
                return true;
            }
            else {
                throw new Error("El validador de billetes no está conectado");
            }
        });
    }
    billCommand(billAcceptance, escrowAcceptance) {
        var _a, _b;
        console.log("Bill validator - Sending bill command...");
        if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
            let command = BillValidator.BILL_COMMAND;
            command[1] = (Number(billAcceptance) >> 8) & 0xff;
            command[2] = (Number(billAcceptance) >> 0) & 0xff;
            command[3] = (Number(escrowAcceptance) >> 8) & 0xff;
            command[4] = (Number(escrowAcceptance) >> 0) & 0xff;
            (_b = this.port) === null || _b === void 0 ? void 0 : _b.write(command);
            return true;
        }
        else {
            throw new Error("El validador de billetes no está conectado");
        }
    }
    escrowCommand(escrowState) {
        var _a, _b;
        console.log("Bill validator - Sending escrow command...");
        if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
            let command = BillValidator.ESCROW_COMMAND;
            command[1] = (Number(escrowState) >> 0) & 0xff;
            (_b = this.port) === null || _b === void 0 ? void 0 : _b.write(command);
            return true;
        }
        else {
            throw new Error("El validador de billetes no está conectado");
        }
    }
    stackerCommand() {
        var _a, _b;
        console.log("Bill validator - Sending stacker command...");
        if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
            let command = BillValidator.STACKER_COMMAND;
            (_b = this.port) === null || _b === void 0 ? void 0 : _b.write(command);
            return true;
        }
        else {
            throw new Error("El validador de billetes no está conectado");
        }
    }
    reset() {
        this.resetCommand();
    }
    activate() {
        this.billCommand(127, 0);
    }
    deactivate() {
        this.billCommand(0, 0);
    }
}
exports.BillValidator = BillValidator;
BillValidator.RESET_COMMAND = [0x30];
BillValidator.SETUP_COMMAND = [0x31];
BillValidator.SECURITY_COMMAND = [0x32, 0x00, 0x00];
BillValidator.POLL_COMMAND = [0x33];
BillValidator.BILL_COMMAND = [0x34, 0x00, 0x00, 0x00, 0x00];
BillValidator.ESCROW_COMMAND = [0x35, 0x00];
BillValidator.STACKER_COMMAND = [0x36];
BillValidator.EXPANSION_COMMAND = "Not implemented";
exports.default = new BillValidator();
