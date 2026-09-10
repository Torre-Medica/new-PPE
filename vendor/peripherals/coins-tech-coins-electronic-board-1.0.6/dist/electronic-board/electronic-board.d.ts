import { EventEmitter } from "typed-event-emitter";
export declare class ElectronicBoard extends EventEmitter {
    private static ACTIVATE_COMMAND;
    private static DEACTIVATE_COMMAND;
    private static RETURN_COMMAND;
    readonly onCoinReceived: (handler: (args_0: String) => void) => import("typed-event-emitter").Listener;
    readonly onBillReceived: (handler: (args_0: String) => void) => import("typed-event-emitter").Listener;
    readonly onBillPending: (handler: (args_0: String) => void) => import("typed-event-emitter").Listener;
    readonly onData: (handler: (args_0: String) => void) => import("typed-event-emitter").Listener;
    readonly onError: (handler: (args_0: String) => void) => import("typed-event-emitter").Listener;
    readonly onAck: (handler: (args_0: Boolean) => void) => import("typed-event-emitter").Listener;
    private stack;
    private stackNumber;
    private port;
    constructor();
    connect(port: string): Promise<Boolean>;
    disconnect(): Boolean;
    toUTF8Array(str: String): number[];
    private calculateChecksum;
    private activateCommand;
    private deactivateCommand;
    private returnCommand;
    activate(): void;
    deactivate(): void;
    return(returnValue: Number, bill1Denomination: Number, bill2Denomination: Number, coin1Denomination: Number, coin2Denomination: Number): void;
}
declare const _default: ElectronicBoard;
export default _default;
