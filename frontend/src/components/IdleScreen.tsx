import { useEffect, useState } from 'react';

// Pantalla de inicio del PPE (esperando QR). Solo es visual: no cambia el flujo de pago.
// La foto principal sale de public/inicio-principal.jpg (1810x516) y las tarjetas de
// public/inicio-ejemplo-N.jpg (565x240). Sirve en 16:9 (Raspberry 1280x720) y 4:3 (1024x768).

const DEFAULT_MESSAGE = 'Escanee su QR para iniciar el pago';
const HERO_W = 1810;
const HERO_H = 516;
const pct = (value: number, total: number) => `${(value / total) * 100}%`;
const at = (x: number, y: number) => ({ left: pct(x, HERO_W), top: pct(y, HERO_H) });

const EXAMPLES = [
  { src: '/inicio-ejemplo-1.jpg', label: 'Así es correcto', ok: true },
  { src: '/inicio-ejemplo-2.jpg', label: 'No tan cerca', ok: false },
  { src: '/inicio-ejemplo-3.jpg', label: 'No tan lejos', ok: false },
];

interface IdleScreenProps {
  statusMessage: string;
  electronicBillingEnabled: boolean;
  onLogoClick: () => void;
}

export function IdleScreen({ statusMessage, electronicBillingEnabled, onLogoClick }: IdleScreenProps) {
  const [active, setActive] = useState(0);
  const offline = /^(Sin conexion|Reconectando)/i.test(statusMessage);
  const notice = !offline && statusMessage !== DEFAULT_MESSAGE ? statusMessage : null;

  // Resalta una tarjeta a la vez: correcto -> muy cerca -> muy lejos
  useEffect(() => {
    const timer = window.setInterval(() => setActive((i) => (i + 1) % EXAMPLES.length), 2500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-[#f3f6fb]">
      {/* Foto principal: ocupa el alto libre y se recorta (sin deformar) desde la esquina
          superior izquierda. La capa interna tiene la proporcion de la foto y el tamano de
          "cover" (unidades cq del contenedor), asi el logo y el pulso caen siempre en su sitio. */}
      <div className="relative min-h-0 w-full flex-1 overflow-hidden" style={{ containerType: 'size' }}>
        <div
          className="absolute left-0 top-0"
          style={{ width: `max(100cqw, 100cqh * ${HERO_W} / ${HERO_H})`, aspectRatio: `${HERO_W} / ${HERO_H}` }}
        >
          <img
            src="/inicio-principal.jpg"
            alt="Acerque el QR de su tiquete al lector a 10 - 15 cm"
            className="h-full w-full select-none"
            draggable={false}
          />
          {/* Pulso sobre el lector ampliado para llamar la atencion */}
          <span
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-[#fc6400] animate-ping"
            style={{ ...at(1525, 200), width: pct(250, HERO_W), aspectRatio: '1' , animationDuration: '2s' }}
            aria-hidden
          />
          {/* Logo de la app en la esquina blanca: conserva los toques para abrir el panel */}
          <span
            className="absolute -translate-x-1/2 -translate-y-1/2 select-none cursor-default"
            style={{ ...at(132, 64), width: pct(190, HERO_W) }}
            onClick={onLogoClick}
          >
            <img src="/LogoCoins.png" alt="PPE Logo" className="w-full" draggable={false} />
          </span>
        </div>
      </div>

      {/* Instruccion principal */}
      <div className="flex shrink-0 items-center justify-between gap-6 px-[2vw] py-[1.6vh]">
        <div className="flex items-center gap-4">
          <span className="flex h-[6.5vh] w-[6.5vh] shrink-0 items-center justify-center rounded-full bg-[#fc6400] text-white shadow-md" aria-hidden>
            <svg className="h-[60%] w-[60%] animate-bounce" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </span>
          <div>
            <h1 className="text-[clamp(1.4rem,4.2vh,2.8rem)] font-extrabold leading-tight tracking-tight text-[#0b2a5b]">
              Acerque el QR de su tiquete al lector
            </h1>
            <p className="text-[clamp(0.95rem,2.3vh,1.5rem)] text-slate-500">
              Sosténgalo quieto a unos <b className="text-[#1565c0]">10 - 15 cm</b> hasta que la pantalla cambie
            </p>
          </div>
        </div>
      </div>

      {/* Ejemplos: se resalta uno a la vez */}
      <div className="grid shrink-0 grid-cols-3 gap-[1.6vw] px-[2vw]">
        {EXAMPLES.map((example, index) => (
          <div
            key={example.src}
            className={`flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-sm transition-all duration-500 ${
              index === active
                ? `scale-[1.02] shadow-lg ring-4 ${example.ok ? 'ring-[#1565c0]' : 'ring-[#fc6400]'}`
                : 'opacity-80'
            }`}
          >
            <img src={example.src} alt="" className="aspect-[565/240] w-full select-none object-cover" draggable={false} />
            <p
              className={`shrink-0 py-[1.1vh] text-center text-[clamp(1rem,3vh,2rem)] font-bold text-white ${
                example.ok ? 'bg-[#1565c0]' : 'bg-[#fc6400]'
              }`}
            >
              {example.label}
            </p>
          </div>
        ))}
      </div>

      {/* Informacion del punto de pago */}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-[3vw] gap-y-1 px-[2vw] py-[1.4vh] text-[clamp(0.85rem,2.1vh,1.3rem)] font-medium text-slate-600">
        <InfoItem icon="cash">Acepta billetes y monedas</InfoItem>
        <InfoItem icon="change">Entrega cambio</InfoItem>
        {electronicBillingEnabled && <InfoItem icon="invoice">Factura electrónica</InfoItem>}
      </div>

      {/* Avisos puntuales (p. ej. QR no valido) */}
      {notice && (
        <p className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-[#0b2a5b]/90 px-6 py-2 text-center text-xl font-semibold text-white shadow-lg">
          {notice}
        </p>
      )}

      {/* Sin conexion: no se puede pagar, se avisa en toda la pantalla (el logo queda encima) */}
      {offline && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b2a5b]/95 px-8 text-center text-white">
          <svg className="mb-6 h-24 w-24 text-[#fc6400]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          <h2 className="text-5xl font-extrabold">Punto de pago fuera de servicio</h2>
          <p className="mt-4 text-2xl text-white/80">Por favor diríjase a la caja o solicite ayuda al personal.</p>
          <p className="mt-8 text-lg text-white/60">{statusMessage}</p>
        </div>
      )}
    </div>
  );
}

function InfoItem({ icon, children }: { icon: 'cash' | 'change' | 'invoice'; children: string }) {
  const paths = {
    cash: (
      <>
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    change: (
      <>
        <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
        <path d="M3 21v-5h5" />
      </>
    ),
    invoice: (
      <>
        <path d="M6 2h9l5 5v15H6z" />
        <path d="M14 2v6h6M9 13h6M9 17h6" />
      </>
    ),
  };
  return (
    <span className="flex items-center gap-2">
      <svg className="h-[1.4em] w-[1.4em] text-[#fc6400]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {paths[icon]}
      </svg>
      {children}
    </span>
  );
}
