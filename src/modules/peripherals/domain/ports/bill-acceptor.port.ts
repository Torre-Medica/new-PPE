export interface BillAcceptorPort {
  connect(port: string): Promise<boolean>;
  disconnect(): boolean;
  activate(acceptedDenominations?: number[]): void;
  deactivate(): void;
  onBillReceived(handler: (amount: string) => void): void;
  onError(handler: (message: string) => void): void;
}
