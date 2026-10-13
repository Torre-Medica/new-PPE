import { useEffect } from 'react';

// Pantallas de la factura a terceros (3: documento, 4A: confirmar, 4B: cliente nuevo).
// El estado vive en App; aqui solo se dibuja y se avisa de cada accion.

// Distribucion de telefono (1-2-3 arriba), la que el cliente espera para un documento
const NUMPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];

function CountdownPill({ label }: { label: string }) {
  return (
    <div className="rounded-full bg-white/80 px-4 py-1.5 text-sm font-medium text-muted shadow-sm">
      {label}
    </div>
  );
}

// Campo de solo lectura que abre el teclado; el error se muestra dentro (no mueve nada)
function TapField({
  label,
  icon,
  value,
  placeholder,
  optional,
  error,
  onTap,
}: {
  label: string;
  icon: string;
  value: string;
  placeholder: string;
  optional?: boolean;
  error?: string | null;
  onTap: () => void;
}) {
  return (
    <div>
      <p className="mb-2 flex items-baseline gap-2 text-lg font-semibold text-[#0b2a5b]">
        {label}
        {optional && <span className="text-base font-normal text-slate-400">(opcional)</span>}
      </p>
      <button
        type="button"
        onClick={onTap}
        className={`flex h-20 w-full items-center gap-4 rounded-2xl border-2 bg-white pl-3 pr-5 text-left shadow-sm transition-colors focus:outline-none focus:ring-4 ${
          error
            ? 'border-alert-500 focus:ring-alert-500/15'
            : value
              ? 'border-brand-300 focus:border-brand-500 focus:ring-brand-500/15'
              : 'border-slate-200 focus:border-brand-500 focus:ring-brand-500/15'
        }`}
      >
        <span
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl ${
            value ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400'
          }`}
          aria-hidden
        >
          {icon}
        </span>
        <span className={`min-w-0 flex-1 truncate text-3xl ${value ? 'font-semibold text-ink' : 'text-slate-400'}`}>
          {value || placeholder}
        </span>
        {error ? (
          <span className="shrink-0 text-lg font-semibold text-alert-600">{error}</span>
        ) : (
          value && <span className="shrink-0 text-2xl text-brand-500" aria-hidden>✓</span>
        )}
      </button>
    </div>
  );
}

export function BillingDocumentScreen({
  value,
  error,
  loading,
  countdownLabel,
  onChange,
  onBack,
  onContinue,
}: {
  value: string;
  error: string | null;
  loading: boolean;
  countdownLabel: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const press = (key: string) => {
    if (loading) return;
    if (key === '⌫') onChange(value.slice(0, -1));
    else if (key === '✓') onContinue();
    else if (value.length < 10) onChange(value + key);
  };

  // Teclado fisico: numeros, borrar y Enter
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') press('⌫');
      else if (event.key === 'Enter') press('✓');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  return (
    // Pantalla completa clara, como la vista de placa
    <div className="fixed inset-0 z-40 flex flex-col bg-[#f3f6fb] px-10 pb-8 pt-6">
      <div className="flex items-center justify-between">
        {/* El logo de Coins lo pone la app (fijo arriba a la izquierda, y abre el panel
            admin con 5 toques); aqui solo se reserva su espacio */}
        <div className="h-14 w-40" aria-hidden />
        <CountdownPill label={countdownLabel} />
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center">
        <h1 className="mb-6 text-5xl font-extrabold tracking-tight text-[#0b2a5b]">Ingrese su cédula o NIT</h1>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex flex-col gap-5">
            {/* Numero escrito; el error va dentro del campo (no mueve nada) */}
            <div
              className={`flex h-24 items-center gap-4 rounded-2xl border-2 bg-white px-6 shadow-sm ${
                error ? 'border-alert-500' : 'border-brand-500'
              }`}
            >
              <span
                className={`min-w-0 flex-1 truncate text-5xl tracking-wider tabular-nums ${
                  value ? 'font-semibold text-ink' : 'font-normal text-slate-400'
                }`}
              >
                {value || 'Ej. 1020304050'}
              </span>
              {error && <span className="shrink-0 text-xl font-semibold text-alert-600">{error}</span>}
              {value && !loading && (
                <button
                  type="button"
                  onClick={() => onChange('')}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-3xl text-slate-400 hover:bg-slate-100"
                  aria-label="Borrar todo"
                >
                  ×
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4">
              {NUMPAD.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => press(key)}
                  disabled={loading}
                  aria-label={key === '⌫' ? 'Borrar' : key === '✓' ? 'Continuar' : key}
                  className={`h-[5.5rem] rounded-2xl text-4xl font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-60 ${
                    key === '✓'
                      ? 'bg-brand-500 text-white hover:bg-brand-600'
                      : key === '⌫'
                        ? 'border border-black/10 bg-slate-100 text-ink'
                        : 'border border-black/10 bg-white text-ink'
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="flex items-start gap-3 text-lg text-ink">
                <span className="mt-0.5 text-brand-500">✓</span>
                <span>Solo cédula o NIT, sin puntos ni guiones</span>
              </p>
              <p className="mt-4 flex items-start gap-3 text-lg text-ink">
                <span className="mt-0.5 text-brand-500">✓</span>
                <span>El sistema calcula el dígito de verificación</span>
              </p>
            </div>

            {/* Altura fija: aparecer "Buscando..." no mueve nada */}
            <div className="flex min-h-[9rem] flex-col items-center justify-center gap-3 text-slate-500">
              {loading && (
                <>
                  <svg className="h-16 w-16 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
                    <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  <span className="text-xl font-medium">Buscando…</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <button type="button" className="touch-button-secondary" onClick={onBack} disabled={loading}>
            Volver
          </button>
          <button type="button" className="touch-button-primary" onClick={onContinue} disabled={loading}>
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}

export function BillingConfirmScreen({
  maskedName,
  maskedDocument,
  maskedEmail,
  isCompany,
  countdownLabel,
  emailSaving,
  emailNotice,
  onChangeEmail,
  onNotMe,
  onConfirm,
}: {
  maskedName: string;
  maskedDocument: string;
  maskedEmail: string;
  isCompany: boolean;
  countdownLabel: string;
  emailSaving: boolean;
  emailNotice: { ok: boolean; text: string } | null;
  onChangeEmail: () => void;
  onNotMe: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="glass-panel relative flex min-h-[calc(100vh-2rem)] max-w-4xl flex-col items-center justify-center text-center">
      <div className="absolute right-6 top-6">
        <CountdownPill label={countdownLabel} />
      </div>
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-100 text-4xl text-brand-700">
        {/* NIT = empresa; cedula = persona */}
        {isCompany ? '🏢' : '👤'}
      </div>
      <h1 className="mt-6 text-[clamp(2rem,4vw,3.4rem)] font-bold leading-tight tracking-[-0.04em] text-ink">
        ¿La factura va a nombre de…?
      </h1>

      <div className="mt-8 w-full max-w-2xl rounded-3xl bg-white/80 px-6 py-6 shadow-sm">
        <p className="text-3xl font-bold tracking-wide text-ink">{maskedName || '—'}</p>
        <p className="mt-2 text-xl text-muted tabular-nums">{maskedDocument}</p>
        {/* Correo de la factura + opcion de cambiarlo (si el cliente cambio de correo) */}
        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-slate-50 py-3 pl-4 pr-3 text-left">
          <p className="min-w-0 truncate whitespace-nowrap text-lg text-ink">
            <span className="mr-2 font-bold text-brand-500">@</span>
            {maskedEmail ? (
              <>
                Se enviará a <span className="font-semibold">{maskedEmail}</span>
              </>
            ) : (
              <span className="text-muted">Sin correo registrado</span>
            )}
          </p>
          <button
            type="button"
            onClick={onChangeEmail}
            disabled={emailSaving}
            className="shrink-0 rounded-xl border-2 border-brand-300 bg-white px-4 py-2 text-base font-semibold text-brand-700 active:scale-95 disabled:opacity-60"
          >
            {emailSaving ? 'Guardando…' : maskedEmail ? '✎ Cambiar correo' : '✎ Agregar correo'}
          </button>
        </div>
      </div>

      {/* Altura fija: el aviso no mueve los botones */}
      <p
        className={`mt-3 min-h-[1.75rem] text-lg font-semibold ${
          emailNotice?.ok ? 'text-brand-600' : 'text-alert-600'
        }`}
      >
        {emailNotice && `${emailNotice.ok ? '✓ ' : ''}${emailNotice.text}`}
      </p>

      <div className="mt-3 grid w-full max-w-2xl grid-cols-2 gap-3">
        <button type="button" className="touch-button-secondary" onClick={onNotMe} disabled={emailSaving}>
          No soy yo
        </button>
        <button type="button" className="touch-button-primary" onClick={onConfirm} disabled={emailSaving}>
          Sí, continuar
        </button>
      </div>
    </div>
  );
}

export function BillingNewCustomerScreen({
  documentLabel,
  name,
  email,
  phone,
  nameError,
  emailError,
  generalError,
  loading,
  countdownLabel,
  onEditName,
  onEditEmail,
  onEditPhone,
  onBack,
  onSave,
}: {
  documentLabel: string;
  name: string;
  email: string;
  phone: string;
  nameError: string | null;
  emailError: string | null;
  generalError: string | null;
  loading: boolean;
  countdownLabel: string;
  onEditName: () => void;
  onEditEmail: () => void;
  onEditPhone: () => void;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    // Pantalla completa clara, igual que la del documento
    <div className="fixed inset-0 z-40 flex flex-col bg-[#f3f6fb] px-10 pb-8 pt-6">
      <div className="flex items-center justify-between">
        {/* Espacio del logo de la app (fijo arriba a la izquierda) */}
        <div className="h-14 w-40" aria-hidden />
        <CountdownPill label={countdownLabel} />
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          {/* section: el teclado sube la pagina hasta que este bloque quede a la vista */}
          <section className="flex flex-col gap-5">
            <div className="mb-1">
              <h1 className="text-5xl font-extrabold tracking-tight text-[#0b2a5b]">
                Registre sus datos para la factura
              </h1>
              <span className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-lg font-semibold text-ink shadow-sm tabular-nums">
                <span className="text-brand-500">🪪</span>
                {documentLabel}
              </span>
            </div>

            <TapField
              label="Nombre o razón social"
              icon="👤"
              value={name}
              placeholder="Toque para escribir"
              error={nameError}
              onTap={onEditName}
            />
            <TapField
              label="Correo electrónico"
              icon="@"
              value={email}
              placeholder="Toque para escribir"
              error={emailError}
              onTap={onEditEmail}
            />
            <TapField
              label="Teléfono"
              icon="📱"
              value={phone}
              placeholder="Toque para escribir"
              optional
              onTap={onEditPhone}
            />
          </section>

          <div className="flex flex-col gap-5 lg:pt-28">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="flex items-start gap-3 text-lg text-ink">
                <span className="mt-0.5 text-brand-500">✓</span>
                <span>La factura electrónica llegará a este correo</span>
              </p>
              <p className="mt-4 flex items-start gap-3 text-lg text-ink">
                <span className="mt-0.5 text-brand-500">✓</span>
                <span>Persona: escriba nombre y apellido</span>
              </p>
              <p className="mt-4 flex items-start gap-3 text-lg text-ink">
                <span className="mt-0.5 text-brand-500">✓</span>
                <span>Ciudad y datos fiscales se llenan solos</span>
              </p>
            </div>
          </div>
        </div>

        {/* Altura fija: un error no desplaza los botones */}
        <p className="mt-6 min-h-[1.75rem] text-xl font-semibold text-alert-600">{generalError}</p>

        <div className="mt-2 grid grid-cols-2 gap-4">
          <button type="button" className="touch-button-secondary" onClick={onBack} disabled={loading}>
            Volver
          </button>
          <button type="button" className="touch-button-primary" onClick={onSave} disabled={loading}>
            {loading ? 'Guardando…' : 'Guardar y continuar'}
          </button>
        </div>
      </div>
    </div>
  );
}
