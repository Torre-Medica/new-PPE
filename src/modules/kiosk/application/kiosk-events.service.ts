import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';

export interface KioskEventPayload {
  type: string;
  data: Record<string, unknown>;
}

@Injectable()
export class KioskEventsService {
  private readonly events$ = new Subject<MessageEvent>();

  getEventStream(): Observable<MessageEvent> {
    return this.events$.asObservable();
  }

  emit(type: string, data: Record<string, unknown>): void {
    this.events$.next({
      type,
      data: {
        type,
        timestamp: new Date().toISOString(),
        ...data,
      },
    });
  }
}
