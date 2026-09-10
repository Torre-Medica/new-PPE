export type MoneySource =
  | 'BILL_VALIDATOR'
  | 'ELECTRONIC_BOARD_COIN'
  | 'ELECTRONIC_BOARD_BILL';

export interface MoneyReceivedEvent {
  source: MoneySource;
  amount: number;
}

export interface PeripheralErrorEvent {
  source: string;
  message: string;
}
