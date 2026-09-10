import { useEffect, useState } from 'react';

export type KbType = 'text' | 'email' | 'numeric' | 'password';

interface Props {
  label: string;
  initialValue: string;
  type: KbType;
  acceptLabel?: string;
  onAccept: (value: string) => void;
  onCancel: () => void;
}

const LETTER_ROWS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['z','x','c','v','b','n','m'],
];

const SYM_ROWS = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['@','#','$','%','&','*','(',')','-','_'],
  ['.','/','?',':',';',',','"',"'",'!','~'],
];

const PANEL_STYLE: React.CSSProperties = {
  background:
    "linear-gradient(rgba(10,20,50,0.08),rgba(10,20,50,0.08)),url('/PARKING-PAYMENT-BG.png') center/cover no-repeat",
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
};

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
      className={`rounded-xl border py-3 text-sm font-semibold transition-all active:scale-95 select-none ${color} ${wide ? 'flex-[2]' : 'flex-1'} min-w-0`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function KeyboardModal({ label, initialValue, type, acceptLabel = 'Aceptar', onAccept, onCancel }: Props) {
  const [value, setValue] = useState(initialValue);
  const [shift, setShift] = useState(false);
  const [symMode, setSymMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const append = (ch: string) => {
    setValue(v => v + (shift && !symMode ? ch.toUpperCase() : ch));
    if (shift) setShift(false);
  };
  const backspace = () => setValue(v => v.slice(0, -1));

  const display = type === 'password' && !showPassword ? '•'.repeat(value.length) : value;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Enter') { onAccept(value); return; }
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Backspace') { setValue(v => v.slice(0, -1)); return; }
      if (type === 'numeric') {
        if (e.key >= '0' && e.key <= '9') setValue(v => v + e.key);
        return;
      }
      if (e.key.length === 1) setValue(v => v + e.key);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [value, type, onAccept, onCancel]);

  // ── Numeric ─────────────────────────────────────────────────────────
  if (type === 'numeric') {
    const numKeys = ['7','8','9','4','5','6','1','2','3','C','0','⌫'];
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="w-64 rounded-4xl border border-white/20 p-5 shadow-kiosk" style={PANEL_STYLE}>
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
            <button className="touch-button-primary" onClick={() => onAccept(value)}>{acceptLabel}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── QWERTY ──────────────────────────────────────────────────────────
  const rows = symMode ? SYM_ROWS : LETTER_ROWS;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="rounded-4xl border border-white/20 p-5 shadow-kiosk"
        style={{ ...PANEL_STYLE, width: '38rem', maxWidth: '96vw' }}
      >
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">{label}</p>
        <div className="mb-3 flex min-h-[2.75rem] items-center rounded-2xl border border-black/10 bg-white/80 px-4 py-2 gap-2">
          <span className="flex-1 truncate text-lg font-semibold text-ink">
            {display ? display : <span className="text-base font-normal text-muted/30">...</span>}
          </span>
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
        </div>
        <div className="mb-3 space-y-1.5">
          {rows.map((row, ri) => (
            <div key={ri} className="flex gap-1">
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
          <div className="flex gap-1">
            {!symMode && (
              <Key label="⇧" accent={shift ? 'active' : undefined} onClick={() => setShift(s => !s)} />
            )}
            {type === 'email' && (
              <Key label="@" onClick={() => append('@')} />
            )}
            <Key label="espacio" wide onClick={() => append(' ')} />
            <Key label={symMode ? 'ABC' : '123'} onClick={() => { setSymMode(m => !m); setShift(false); }} />
            <Key label="⌫" onClick={backspace} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="touch-button-secondary" onClick={onCancel}>Cancelar</button>
          <button className="touch-button-primary" onClick={() => onAccept(value)}>{acceptLabel}</button>
        </div>
      </div>
    </div>
  );
}
