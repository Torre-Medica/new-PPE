import { useEffect, useState } from 'react';
import { useCompactScreen } from '../lib/useCompactScreen';

// Pantalla "Tiempo de gracia": el QR leido no tiene cobro y aun puede salir gratis.
// Colores: naranja del logo de Coins (#fc6400); rojo cuando la gracia vencio.
// Cuenta regresiva en vivo hasta graceUntil; ilustracion de carro o moto segun el QR.

export interface GraceInfo {
  graceUntil: string;
  graceMinutes: number;
  vehiclePlate: string | null;
  vehicleType: 'CARRO' | 'MOTO' | null;
}

function formatRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Segundos que la pantalla queda visible antes de volver al inicio
export const GRACE_SCREEN_SECONDS = 10;

export function GraceScreen({ info }: { info: GraceInfo }) {
  useCompactScreen();
  const until = new Date(info.graceUntil).getTime();
  const [now, setNow] = useState(() => Date.now());
  const [shownAt] = useState(() => Date.now());
  const closesIn = Math.max(0, GRACE_SCREEN_SECONDS - Math.floor((now - shownAt) / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remainingMs = Math.max(0, until - now);
  const totalMs = info.graceMinutes * 60_000;
  const progress = totalMs > 0 ? Math.min(100, (remainingMs / totalMs) * 100) : 0;
  const expired = remainingMs <= 0;
  const isMoto = info.vehicleType === 'MOTO';

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#f3f6fb]">
      {/* Encabezado (sin fecha ni hora): esta pantalla tapa el logo de la app, lleva el suyo */}
      <header className="flex items-center gap-8 border-b border-slate-200 bg-white/70 px-10 py-6">
        <img src="/LogoCoins.png" alt="Coins" className="h-14 w-auto shrink-0 object-contain" />
        <div className="h-14 w-px bg-slate-300" aria-hidden />
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-[#0b2a5b]">Salida del parqueadero</h1>
          <p className="mt-1 text-2xl text-slate-500">Tiempo de gracia</p>
        </div>
        {/* Cuenta regresiva hasta volver al inicio, como en las otras vistas */}
        <div className="ml-auto rounded-full bg-white/80 px-4 py-1.5 text-sm font-medium text-muted shadow-sm">
          Volverá al inicio en: {closesIn} s
        </div>
      </header>

      <div className="mx-auto grid min-h-0 w-full max-w-[1700px] flex-1 gap-8 px-10 py-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Izquierda: estado, placa y tiempo restante */}
        <section className="flex min-h-0 flex-col justify-between gap-6 rounded-3xl bg-white p-10 shadow-sm">
          <div className="flex items-center gap-8">
            <span
              className={`flex h-32 w-32 shrink-0 items-center justify-center rounded-full ${
                expired ? 'bg-red-600' : 'bg-[#fc6400]'
              }`}
              aria-hidden
            >
              <svg className="h-16 w-16 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </span>
            <div>
              <h2 className="text-5xl font-extrabold tracking-tight text-[#0b2a5b]">
                {expired ? 'Tu tiempo de gracia terminó' : '¡Tienes tiempo de gracia!'}
              </h2>
              <p className="mt-3 text-2xl leading-snug text-slate-500">
                {expired
                  ? 'Escanea de nuevo tu QR para pagar el tiempo adicional.'
                  : 'Puedes salir del parqueadero sin costo adicional dentro del tiempo establecido.'}
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-[#f3f6fb] p-8">
            <div className={`grid items-center gap-6 ${info.vehiclePlate ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-1'}`}>
              {/* Placa: solo si el ingreso ya la tiene */}
              {info.vehiclePlate && (
                <>
                  <div className="flex items-center gap-6">
                    <VehicleIcon moto={isMoto} />
                    <div>
                      <p className="text-xl text-slate-500">Placa</p>
                      <p className="text-5xl font-extrabold tracking-wide text-[#0b2a5b]">{info.vehiclePlate}</p>
                    </div>
                  </div>
                  <div className="h-20 w-px bg-slate-300" aria-hidden />
                </>
              )}
              <div className="flex items-center gap-6">
                <svg className="h-20 w-20 shrink-0 text-[#0b2a5b]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <div>
                  <p className="whitespace-nowrap text-xl text-slate-500">Tiempo de gracia</p>
                  <p className="whitespace-nowrap text-5xl font-extrabold text-[#0b2a5b]">{info.graceMinutes} min</p>
                </div>
              </div>
            </div>

            <div className="mt-8 h-5 overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${expired ? 'bg-red-600' : 'bg-[#fc6400]'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-5 flex items-center justify-between gap-4">
              <p className="text-2xl text-slate-600">Tiempo restante para salir sin costo</p>
              <p className={`whitespace-nowrap text-5xl font-extrabold tabular-nums ${expired ? 'text-red-600' : 'text-[#e65c00]'}`}>
                {formatRemaining(remainingMs)} min
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 rounded-2xl bg-[#fff1e6] p-7">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#fc6400]" aria-hidden>
              <svg className="h-9 w-9 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12 5 5L20 7" />
              </svg>
            </span>
            <div>
              <p className="text-2xl font-bold text-[#e65c00]">Gracias por tu visita</p>
              <p className="mt-1 text-xl text-slate-600">
                Recuerda que al salir después del tiempo de gracia, se generará el cobro correspondiente.
              </p>
            </div>
          </div>
        </section>

        {/* Derecha: ilustracion de la salida (carro o moto) */}
        <section className="flex flex-col items-center justify-between rounded-3xl border border-slate-200 bg-gradient-to-b from-[#eef2f8] to-[#e5ebf4] p-10 text-center">
          <img src="/LogoCoins.png" alt="Coins" className="h-16 w-auto object-contain" />
          <ExitIllustration moto={isMoto} />
          <div>
            <p className="text-4xl font-extrabold leading-tight text-[#0b2a5b]">
              {expired ? 'Escanea para pagar' : 'Puedes continuar con tu salida'}
            </p>
            <p className="mt-3 text-xl text-slate-500">
              {expired ? 'El tiempo de gracia ya terminó.' : 'El tiempo de gracia aún está activo.'}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function VehicleIcon({ moto }: { moto: boolean }) {
  // Iconos del diseno (public/icono-moto.png, public/icono-carro.png)
  return (
    <img
      src={moto ? '/icono-moto.png' : '/icono-carro.png'}
      alt=""
      aria-hidden
      className="h-16 w-auto shrink-0 select-none object-contain"
      draggable={false}
    />
  );
}

// Barrera levantada con el vehiculo visto de atras: ilustraciones del diseno
// (public/salida-moto.png, public/salida-carro.png)
function ExitIllustration({ moto }: { moto: boolean }) {
  return (
    <img
      src={moto ? '/salida-moto.png' : '/salida-carro.png'}
      alt=""
      aria-hidden
      className="my-6 w-full max-w-md select-none object-contain"
      draggable={false}
    />
  );
}
