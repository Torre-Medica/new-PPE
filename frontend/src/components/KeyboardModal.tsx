import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type KbType = 'text' | 'email' | 'numeric' | 'password';

interface Props {
  label: string;
  initialValue: string;
  type: KbType;
  acceptLabel?: string;
  // Devuelve un mensaje de error para no cerrar el teclado, o null si el valor es valido
  validate?: (value: string) => string | null;
  // Escribe todo en mayusculas (ej. placas)
  uppercase?: boolean;
  // Instruccion grande y explicita para el cliente (ej. "Ingrese la placa de su carro")
  title?: string;
  hint?: string;
  // Ejemplo que se ve dentro del campo mientras esta vacio
  placeholder?: string;
  // Icono sobre el titulo en la vista de pantalla completa
  imageSrc?: string;
  // Halo celeste detras del icono (apagarlo si la imagen ya trae su propio fondo)
  imageHalo?: boolean;
  // Pantalla completa clara (logo, icono, titulo grande) en vez del panel inferior
  fullscreen?: boolean;
  // Segundos sin interaccion antes de llamar onIdleTimeout (cualquier toque o tecla reinicia)
  idleTimeoutSeconds?: number;
  onIdleTimeout?: () => void;
  // Se llama en cada cambio para que el formulario muestre lo que se va escribiendo
  onChange?: (value: string) => void;
  // Clic por fuera del teclado acoplado (por defecto: onCancel)
  onDismiss?: () => void;
  onAccept: (value: string) => void;
  onCancel: () => void;
}

const LETTER_ROWS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l','ñ'],
  ['z','x','c','v','b','n','m'],
];

// Los numeros ya estan en el teclado numerico de la derecha, asi que el modo
// simbolos usa la primera fila para mas signos.
const SYM_ROWS = [
  ['+','=','[',']','{','}','<','>','|','\\'],
  ['@','#','$','%','&','*','(',')','-','_'],
  ['.','/','?',':',';',',','"',"'",'!','~'],
];

// Teclado numerico a la derecha (4 filas, alineado con las 4 filas del QWERTY)
const NUMPAD_ROWS = [
  ['7','8','9'],
  ['4','5','6'],
  ['1','2','3'],
  ['-','0','.'],
];

const PANEL_STYLE: React.CSSProperties = {
  background:
    "linear-gradient(rgba(10,20,50,0.08),rgba(10,20,50,0.08)),url('/PARKING-PAYMENT-BG.png') center/cover no-repeat",
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
};

// Desplazamiento de la pagina compartido entre teclados: al pasar de un campo a otro
// no se baja y vuelve a subir el formulario, solo se ajusta.
let currentPageShift = 0;
let pageShiftResetTimer: number | undefined;

function applyPageShift(shift: number) {
  const appRoot = document.getElementById('root');
  if (!appRoot) return;
  currentPageShift = Math.ceil(shift);
  appRoot.style.transition = 'transform 200ms ease';
  appRoot.style.transform = currentPageShift > 0 ? `translateY(-${currentPageShift}px)` : '';
}

// Posicion vertical en la ventana segun el diseno de la pagina: offsetTop no incluye
// transformaciones, asi que no depende del desplazamiento aplicado ni de su animacion.
function layoutRect(element: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let current: HTMLElement | null = element;
  while (current) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  // Contenedores con scroll interno entre el elemento y la pagina
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    top -= parent.scrollTop;
  }
  return { top, bottom: top + element.offsetHeight };
}

function cancelPageShiftReset() {
  window.clearTimeout(pageShiftResetTimer);
}

function schedulePageShiftReset() {
  cancelPageShiftReset();
  pageShiftResetTimer = window.setTimeout(() => applyPageShift(0), 80);
}

interface KeyProps {
  label: string;
  wide?: boolean;
  accent?: 'primary' | 'danger' | 'active';
  onClick: () => void;
}

function Key({ label, wide, accent, onClick }: KeyProps) {
  const color =
    accent === 'primary' ? 'bg-brand-500 text-white border-brand-600 shadow-sm' :
    accent === 'danger'  ? 'bg-alert-50 text-alert-600 border-alert-200' :
    accent === 'active'  ? 'bg-brand-100 text-brand-700 border-brand-300' :
    'bg-white/80 text-ink border-black/10';
  return (
    <button
      className={`rounded-2xl border py-5 [@media(max-height:820px)]:py-3 text-2xl font-semibold transition-all active:scale-95 select-none ${color} ${wide ? 'flex-[3]' : 'flex-1'} min-w-0`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function KeyboardModal({
  label,
  initialValue,
  type,
  acceptLabel = 'Aceptar',
  validate,
  uppercase = false,
  title,
  hint,
  placeholder,
  imageSrc,
  imageHalo = true,
  fullscreen = false,
  idleTimeoutSeconds,
  onIdleTimeout,
  onChange,
  onDismiss,
  onAccept,
  onCancel,
}: Props) {
  const [value, setValue] = useState(uppercase ? initialValue.toUpperCase() : initialValue);
  const [shift, setShift] = useState(false);
  const [symMode, setSymMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idleSeconds, setIdleSeconds] = useState(idleTimeoutSeconds ?? 0);
  const idleEnabled = !!idleTimeoutSeconds && !!onIdleTimeout;
  const resetIdle = () => {
    if (idleEnabled) setIdleSeconds(idleTimeoutSeconds!);
  };

  // Teclado acoplado abajo (sin tapar la pantalla): se sube el contenido de la pagina
  // para que el formulario quede visible sobre el teclado (ver applyPageShift).
  const dockedPanelRef = useRef<HTMLDivElement>(null);
  const fieldBeingFilled = useRef<Element | null>(
    typeof document !== 'undefined' ? document.activeElement : null,
  );
  useLayoutEffect(() => {
    if (fullscreen) return;
    cancelPageShiftReset();
    const panel = dockedPanelRef.current;
    const field = fieldBeingFilled.current;
    const isFormField =
      field instanceof HTMLElement &&
      field !== document.body &&
      // Si el foco quedo en un boton de otro teclado (ej. correo -> contrasena) no es
      // un campo: se conserva el desplazamiento que ya tenia el formulario.
      !field.closest('[data-keyboard-panel]');

    if (panel && isFormField) {
      // Posiciones de diseno (sin el desplazamiento ni la animacion en curso)
      const fieldRect = layoutRect(field);
      const form = field.closest('form, .glass-panel, section');
      const formRect = form instanceof HTMLElement ? layoutRect(form) : fieldRect;
      const visibleBottom = window.innerHeight - panel.offsetHeight - 16;
      // Formulario completo sobre el teclado sin cortar su parte de arriba; como minimo,
      // el campo que se esta llenando.
      const fieldOverlap = fieldRect.bottom - visibleBottom;
      const formOverlap = Math.min(formRect.bottom - visibleBottom, formRect.top - 8);
      applyPageShift(Math.max(0, fieldOverlap, formOverlap));
    }

    // Al cerrarse, el formulario baja solo si no se abrio otro teclado enseguida
    return () => schedulePageShiftReset();
  }, [fullscreen]);

  // Clic por fuera del teclado acoplado: se oculta (igual que Cancelar). Se escucha en
  // fase de captura del "click", asi si se toco otro campo ese mismo clic abre su teclado.
  useEffect(() => {
    if (fullscreen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-keyboard-panel]')) return;
      (onDismiss ?? onCancel)();
    };
    document.addEventListener('click', handleOutsideClick, true);
    return () => document.removeEventListener('click', handleOutsideClick, true);
  }, [fullscreen, onCancel, onDismiss]);

  // Cuenta regresiva por inactividad; al llegar a 0 avisa una sola vez
  useEffect(() => {
    if (!idleEnabled) return;
    const timer = window.setInterval(() => setIdleSeconds(s => (s > 0 ? s - 1 : 0)), 1000);
    return () => window.clearInterval(timer);
  }, [idleEnabled]);

  useEffect(() => {
    if (idleEnabled && idleSeconds === 0) onIdleTimeout!();
  }, [idleEnabled, idleSeconds, onIdleTimeout]);

  // El error se limpia apenas se corrige el valor
  useEffect(() => setError(null), [value]);

  // El formulario se actualiza en vivo con cada tecla (no en el primer render)
  const firstValueRender = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (firstValueRender.current) {
      firstValueRender.current = false;
      return;
    }
    onChangeRef.current?.(value);
  }, [value]);

  const submit = () => {
    const message = validate?.(value) ?? null;
    if (message) {
      setError(message);
      return;
    }
    onAccept(value);
  };

  const append = (ch: string) => {
    setValue(v => v + (uppercase || (shift && !symMode) ? ch.toUpperCase() : ch));
    if (shift) setShift(false);
  };
  const backspace = () => setValue(v => v.slice(0, -1));

  const display = type === 'password' && !showPassword ? '•'.repeat(value.length) : value;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      resetIdle();
      if (e.key === 'Enter') { submit(); return; }
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Backspace') { setValue(v => v.slice(0, -1)); return; }
      if (type === 'numeric') {
        if (e.key >= '0' && e.key <= '9') setValue(v => v + e.key);
        return;
      }
      if (e.key.length === 1) setValue(v => v + (uppercase ? e.key.toUpperCase() : e.key));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [value, type, uppercase, validate, onAccept, onCancel]);

  // ── Numeric ─────────────────────────────────────────────────────────
  if (type === 'numeric') {
    const numKeys = ['7','8','9','4','5','6','1','2','3','C','0','⌫'];
    return createPortal(
      <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center" data-keyboard-panel>
        <div ref={dockedPanelRef} className="mb-4 w-64 rounded-4xl border border-white/20 p-5 shadow-kiosk" style={PANEL_STYLE}>
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">{label}</p>
          <div className="mb-4 flex min-h-[3rem] items-center justify-center rounded-2xl border border-black/10 bg-white/80 px-4 py-2 text-2xl font-semibold text-ink">
            {value || <span className="text-lg text-muted/40">—</span>}
          </div>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {numKeys.map(k => (
              <button
                key={k}
                className={`rounded-xl border py-4 text-lg font-semibold transition-all active:scale-95 select-none ${
                  k === 'C'  ? 'bg-alert-50 text-alert-600 border-alert-200' :
                  k === '⌫' ? 'bg-white/70 text-muted border-black/10' :
                  'bg-white/80 text-ink border-black/10'
                }`}
                onClick={() => {
                  if (k === 'C') setValue('');
                  else if (k === '⌫') backspace();
                  else append(k);
                }}
              >{k}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="touch-button-secondary" onClick={onCancel}>Cancelar</button>
            <button className="touch-button-primary" onClick={submit}>{acceptLabel}</button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── QWERTY ──────────────────────────────────────────────────────────
  const rows = symMode ? SYM_ROWS : LETTER_ROWS;

  // Teclas (letras + teclado numerico): iguales en el panel y en la vista de pantalla completa
  const keysBlock = (
        <div className="mb-4 [@media(max-height:820px)]:mb-3 flex gap-5">
          {/* Letras / simbolos */}
          <div className="min-w-0 flex-1 space-y-2">
            {rows.map((row, ri) => (
              <div key={ri} className="flex gap-2">
                {row.map(k => (
                  <Key
                    key={k}
                    label={!symMode && shift ? k.toUpperCase() : k}
                    onClick={() => append(k)}
                  />
                ))}
              </div>
            ))}
            {/* Bottom action row */}
            <div className="flex gap-2">
              {!symMode && (
                <Key label="⇧" accent={shift ? 'active' : undefined} onClick={() => setShift(s => !s)} />
              )}
              <Key label="@" onClick={() => append('@')} />
              <Key label="espacio" wide onClick={() => append(' ')} />
              <Key label={symMode ? 'ABC' : '#+='} onClick={() => { setSymMode(m => !m); setShift(false); }} />
              <Key label="⌫" onClick={backspace} />
            </div>
          </div>
          {/* Teclado numerico */}
          <div className="w-[26%] shrink-0 space-y-2 border-l border-black/10 pl-5">
            {NUMPAD_ROWS.map((row, ri) => (
              <div key={ri} className="flex gap-2">
                {row.map(k => (
                  <Key key={k} label={k} onClick={() => append(k)} />
                ))}
              </div>
            ))}
          </div>
        </div>
  );

  const passwordToggle = (
    <>
          {type === 'password' && (
            <button
              type="button"
              className="shrink-0 text-muted/60 hover:text-ink transition-colors active:scale-95"
              onClick={() => setShowPassword(v => !v)}
            >
              {showPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              )}
            </button>
          )}
    </>
  );

  const errorMessage = error && (
    <p className="-mt-2 mb-3 rounded-xl bg-alert-50 px-4 py-2 text-lg font-semibold text-alert-600">{error}</p>
  );

  const actions = (
    <div className="grid grid-cols-2 gap-3">
      <button className="touch-button-secondary" onClick={onCancel}>Cancelar</button>
      <button className="touch-button-primary" onClick={submit}>{acceptLabel}</button>
    </div>
  );

  // ── Vista de pantalla completa (ej. "Ingresa tu placa") ──────────────
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[#f3f6fb] px-10 pb-8 pt-6 [@media(max-height:820px)]:pb-3 [@media(max-height:820px)]:pt-3" onPointerDownCapture={resetIdle}>
        <div className="flex items-center justify-between">
          <img src="/LogoCoins.png" alt="Coins" className="h-12 w-auto select-none [@media(max-height:820px)]:h-9" draggable={false} />
          {idleEnabled && (
            <div className="rounded-full bg-white px-5 py-2 text-lg font-medium text-slate-600 shadow-sm">
              {idleSeconds > 0 ? `Cancelacion en: ${idleSeconds} s` : 'Cancelando...'}
            </div>
          )}
        </div>
        <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col justify-center">
          <div className="mb-6 [@media(max-height:820px)]:mb-3 flex flex-col items-center text-center">
            {imageSrc && (
              <div className="relative mb-3 flex h-36 min-w-[18rem] [@media(max-height:820px)]:mb-1 [@media(max-height:820px)]:h-20 items-center justify-center px-4">
                {/* halo celeste detras del icono */}
                {imageHalo && <div className="absolute inset-0 rounded-full bg-brand-100/70 blur-2xl" />}
                <img
                  src={imageSrc}
                  alt=""
                  className="relative h-32 w-auto max-w-none [@media(max-height:820px)]:h-[4.5rem] select-none mix-blend-multiply"
                  draggable={false}
                />
              </div>
            )}
            <h2 className="text-6xl font-extrabold tracking-tight [@media(max-height:820px)]:text-4xl text-[#0b2a5b]">{title ?? label}</h2>
            {hint && <p className="mt-3 text-2xl text-slate-600 [@media(max-height:820px)]:mt-1 [@media(max-height:820px)]:text-lg">{hint}</p>}
          </div>
          {/* El error va dentro del campo (no agrega altura) para que el teclado y los
              botones no se desplacen fuera de la pantalla */}
          <div
            className={`mb-5 flex h-[5.5rem] items-center [@media(max-height:820px)]:mb-3 [@media(max-height:820px)]:h-16 gap-4 rounded-2xl border-2 bg-white px-6 shadow-sm ${
              error ? 'border-alert-500' : 'border-brand-500'
            }`}
          >
            <span className="min-w-0 flex-1 truncate text-4xl font-semibold [@media(max-height:820px)]:text-3xl text-ink">
              {display ? display : <span className="font-normal text-slate-400">{placeholder ?? '...'}</span>}
            </span>
            {error && (
              <span className="max-w-[55%] shrink-0 text-right text-lg font-semibold leading-tight text-alert-600">
                {error}
              </span>
            )}
            {passwordToggle}
          </div>
          {keysBlock}
          {actions}
        </div>
      </div>
    );
  }

  return createPortal(
    // Teclado acoplado abajo, sin fondo oscuro: el formulario sigue visible arriba
    <div className="fixed inset-x-0 bottom-0 z-50" onPointerDownCapture={resetIdle} data-keyboard-panel>
      <div
        ref={dockedPanelRef}
        className="w-full rounded-t-4xl border-t border-white/20 px-6 pb-6 pt-5 shadow-kiosk"
        style={PANEL_STYLE}
      >
        {title ? (
          <div className="mb-4">
            <h2 className="text-4xl font-bold text-ink">{title}</h2>
            {hint && <p className="mt-1 text-xl text-muted">{hint}</p>}
          </div>
        ) : (
          <p className="mb-2 text-sm uppercase tracking-[0.18em] text-muted">{label}</p>
        )}
        <div className="mb-4 flex min-h-[4rem] items-center rounded-2xl border border-black/10 bg-white/80 px-5 py-3 gap-3">
          <span className="flex-1 truncate text-3xl font-semibold text-ink">
            {display ? display : <span className="text-2xl font-normal text-muted/40">{placeholder ?? '...'}</span>}
          </span>
          {passwordToggle}
        </div>
        {errorMessage}
        {keysBlock}
        {actions}
      </div>
    </div>,
    document.body,
  );
}
