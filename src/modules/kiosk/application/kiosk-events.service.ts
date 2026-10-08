import { Injectable } from '@nestjs/common';
import { Observable, Subject, interval, map, merge } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';

export interface KioskEventPayload {
  type: string;
  data: Record<string, unknown>;
}

// Latido del SSE: le permite al frontend detectar una conexion muerta (backend
// reiniciado y el proxy de vite dejando la conexion colgada) y reconectarse.
const HEARTBEAT_INTERVAL_MS = 10_000;

@Injectable()
export class KioskEventsService {
  private readonly events$ = new Subject<MessageEvent>();

  getEventStream(): Observable<MessageEvent> {
    const heartbeat$ = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map(
        (): MessageEvent => ({
          type: 'kiosk.heartbeat',
          data: { type: 'kiosk.heartbeat', timestamp: new Date().toISOString() },
        }),
      ),
    );

    return merge(this.events$.asObservable(), heartbeat$);
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
