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
exports.ElectronicBoard = void 0;
const { SerialPort } = require("serialport");
const typed_event_emitter_1 = require("typed-event-emitter");
class ElectronicBoard extends typed_event_emitter_1.EventEmitter {
    constructor() {
        super();
        this.onCoinReceived = this.registerEvent();
        this.onBillReceived = this.registerEvent();
        this.onBillPending = this.registerEvent();
        this.onData = this.registerEvent();
        this.onError = this.registerEvent();
        this.onAck = this.registerEvent();
        this.stack = new Uint8Array([]);
        this.stackNumber = 0;
    }
    connect(port) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("Conectando la tarjeta electrónica");
            this.port = new SerialPort({
                path: port,
                baudRate: 9600
            }, (error) => {
                if (error) {
                    throw new Error("Error conectando la tarjeta electrónica: " + error.message);
                }
                return false;
            });
            this.port.on("data", (data) => {
                if (this.stackNumber === 0) {
                    this.stackNumber = Number(data[0]);
                }
                this.stack = new Uint8Array([...this.stack, ...data]);
                console.log("Original:");
                console.log(this.stack);
                while (this.stack[0] != 6 && this.stack[0] != 7 && this.stack.length != 0)
                    this.stack = this.stack.slice(1);
                console.log("Limpieza:");
                console.log(this.stack);
                let trama = new Uint8Array([]);
                this.stackNumber = this.stack[0];
                if (this.stack.length >= this.stack[0]) {
                    trama = this.stack.subarray(0, this.stackNumber);
                    this.stack = this.stack.slice(this.stackNumber);
                    if (this.stack.length > 0) {
                        this.stackNumber = this.stack[0];
                    }
                    else {
                        this.stackNumber = 0;
                    }
                }
                if (trama.length > 0) {
                    console.log(trama);
                    if (trama[0] === 6) {
                        const success = trama[3] === 255;
                        if (success) {
                            console.log("Trama de éxito");
                        }
                        else {
                            console.log("Trama de fallo");
                        }
                        this.emit(this.onAck, success);
                    }
                    else if (trama[0] === 7) {
                        if (trama[3] === 51) {
                            if (trama[4] === 100) {
                                console.log("Trama de 1000");
                                this.emit(this.onCoinReceived, '1000');
                            }
                            else if (trama[4] === 50) {
                                console.log("Trama de 500");
                                this.emit(this.onCoinReceived, '500');
                            }
                            else if (trama[4] === 20) {
                                console.log("Trama de 200");
                                this.emit(this.onCoinReceived, '200');
                            }
                            else if (trama[4] === 10) {
                                console.log("Trama de 100");
                                this.emit(this.onCoinReceived, '100');
                            }
                            else if (trama[4] === 5) {
                                console.log("Trama de 50");
                                this.emit(this.onCoinReceived, '50');
                            }
                        }
                        else if (trama[3] === 50) {
                            if (trama[4] === 100) {
                                console.log("Trama de 100000");
                                this.emit(this.onBillReceived, '100000');
                            }
                            else if (trama[4] === 50) {
                                console.log("Trama de 50000");
                                this.emit(this.onBillReceived, '50000');
                            }
                            else if (trama[4] === 20) {
                                console.log("Trama de 20000");
                                this.emit(this.onBillReceived, '20000');
                            }
                            else if (trama[4] === 10) {
                                console.log("Trama de 10000");
                                this.emit(this.onBillReceived, '10000');
                            }
                            else if (trama[4] === 5) {
                                console.log("Trama de 5000");
                                this.emit(this.onBillReceived, '5000');
                            }
                            else if (trama[4] === 2) {
                                console.log("Trama de 2000");
                                this.emit(this.onBillReceived, '2000');
                            }
                            else if (trama[4] === 1) {
                                console.log("Trama de 1000");
                                this.emit(this.onBillReceived, '1000');
                            }
                        }
                    }
                }
            });
            this.port.on('error', (error) => {
                this.emit(this.onError, "Ha ocurrido un error con el puerto de la tarjeta electrónica: " + error);
            });
            this.port.on('close', (error) => {
                this.emit(this.onError, "Se ha cerrado el puerto de la tarjeta electrónica: " + error);
            });
            this.port.on('disconnect', (error) => {
                this.emit(this.onError, "Se ha desconectado el puerto de la tarjeta electrónica: " + error);
            });
            return true;
        });
    }
    disconnect() {
        var _a;
        if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
            this.port.close((error) => {
                if (error) {
                    throw new Error("Error desconectando la tarjeta electrónica: " + error.message);
                }
                return false;
            });
        }
        return true;
    }
    toUTF8Array(str) {
        var utf8 = [];
        for (var i = 0; i < str.length; i++) {
            var charcode = str.charCodeAt(i);
            if (charcode < 0x80)
                utf8.push(charcode);
            else if (charcode < 0x800) {
                utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
            }
            else if (charcode < 0xd800 || charcode >= 0xe000) {
                utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
            }
            // surrogate pair
            else {
                i++;
                // UTF-16 encodes 0x10000-0x10FFFF by
                // subtracting 0x10000 and splitting the
                // 20 bits of 0x0-0xFFFFF into two halves
                charcode = 0x10000 + (((charcode & 0x3ff) << 10)
                    | (str.charCodeAt(i) & 0x3ff));
                utf8.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
            }
        }
        return utf8;
    }
    calculateChecksum(command) {
        let checksum = 0;
        for (let byte of command) {
            checksum += Number(byte);
        }
        console.log("Checksum: " + checksum);
        command[command.length - 2] = (checksum >> 8) & 0xff;
        command[command.length - 1] = checksum & 0xff;
        return command;
    }
    activateCommand() {
        var _a, _b;
        console.log("Electronic board - Sending activate command...");
        if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
            let command = ElectronicBoard.ACTIVATE_COMMAND;
            for (let byte of command) {
                (_b = this.port) === null || _b === void 0 ? void 0 : _b.write([byte]);
            }
            return true;
        }
        else {
            throw new Error("La tarjeta electrónica no está conectada");
        }
    }
    deactivateCommand() {
        var _a, _b;
        console.log("Electronic board - Sending desactivate command...");
        if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
            let command = ElectronicBoard.DEACTIVATE_COMMAND;
            for (let byte of command) {
                (_b = this.port) === null || _b === void 0 ? void 0 : _b.write([byte]);
            }
            return true;
        }
        else {
            throw new Error("La tarjeta electrónica no está conectada");
        }
    }
    returnCommand(returnValue, bill1Denomination, bill2Denomination, coin1Denomination, coin2Denomination) {
        var _a, _b;
        console.log("Electronic board - Sending return command...");
        if ((_a = this.port) === null || _a === void 0 ? void 0 : _a.isOpen) {
            let command = [0x0e, 0xc9, 0x01, 0x3c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
            command[4] = Number(bill1Denomination) / 1000;
            command[5] = Number(bill2Denomination) / 1000;
            command[6] = Number(coin1Denomination) / 10;
            command[7] = Number(coin2Denomination) / 10;
            command[8] = (Number(returnValue) & 0xff000000) >> 24;
            command[9] = (Number(returnValue) & 0xff0000) >> 16;
            command[10] = (Number(returnValue) & 0xff00) >> 8;
            command[11] = Number(returnValue) & 0xff;
            let commandWithChecksum = this.calculateChecksum(command);
            console.log(commandWithChecksum);
            for (let byte of commandWithChecksum) {
                (_b = this.port) === null || _b === void 0 ? void 0 : _b.write([byte]);
            }
            return true;
        }
        else {
            throw new Error("La tarjeta electrónica no está conectada");
        }
    }
    activate() {
        this.activateCommand();
    }
    deactivate() {
        this.deactivateCommand();
    }
    return(returnValue, bill1Denomination, bill2Denomination, coin1Denomination, coin2Denomination) {
        this.returnCommand(returnValue, bill1Denomination, bill2Denomination, coin1Denomination, coin2Denomination);
    }
}
exports.ElectronicBoard = ElectronicBoard;
ElectronicBoard.ACTIVATE_COMMAND = [0x06, 0xc9, 0x01, 0x0a, 0x00, 0xda];
ElectronicBoard.DEACTIVATE_COMMAND = [0x06, 0xc9, 0x01, 0x0c, 0x00, 0xdc];
ElectronicBoard.RETURN_COMMAND = [0x0e, 0xc9, 0x01, 0x3c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
exports.default = new ElectronicBoard();
