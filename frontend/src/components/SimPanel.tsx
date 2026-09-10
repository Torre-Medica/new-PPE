import { useState } from 'react';
import type { PaymentDetails, PaymentStage } from '../lib/types';
import {
  cancelKioskSession,
  insertSimulatedCash,
  startSimulatedPaymentSession,
} from '../lib/sim-api';

const fmt = new Intl.NumberFormat('es-CO');
const money = (n: number) => `$${fmt.format(n)}`;

const SIM_SESSION_ID = 'sim-session-001';
const BILLS = [1000, 2000, 5000, 10000, 20000, 50000];
const COINS = [200, 500];
const PRESET_AMOUNTS = [500, 1000, 2000, 3500, 5000, 8500, 10000, 15000, 25000, 50000];

interface Props {
  paymentStage: PaymentStage;
  paymentDetails: PaymentDetails;
}

export function SimPanel({ paymentStage, paymentDetails }: Props) {
  const [open, setOpen] = useState(true);
  const [simAmount, setSimAmount] = useState(5000);
  const [simQr, setSimQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sessionId = paymentDetails.paymentSessionId || SIM_SESSION_ID;
  const amountDue = paymentDetails.amountDue;
  const inserted = paymentDetails.insertedAmount;
  const remaining = Math.max(0, amountDue - inserted);
  const canAcceptCash =
    paymentStage === 'collecting' &&
    paymentDetails.status === 'LISTENING_CASH' &&
    remaining > 0 &&
    !busy;

  async function triggerQRScan() {
    const qrCode = simQr.trim();
    if (!qrCode) {
      setError('Ingrese un QR real para probar contra nexo_back');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await startSimulatedPaymentSession(simAmount, qrCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible simular el QR');
    } finally {
      setBusy(false);
    }
  }

  async function insertCash(denomination: number) {
    if (!canAcceptCash) {
      setError('Monto completo o sesion procesando. Espere la confirmacion del pago.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await insertSimulatedCash(sessionId, denomination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible insertar efectivo simulado');
    } finally {
      setBusy(false);
    }
  }

  async function cancelSession() {
    setBusy(true);
    setError('');
    try {
      await cancelKioskSession(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cancelar la sesion');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-68 rounded-3xl border-2 border-brand-300 bg-white shadow-kiosk overflow-hidden" style={{ width: '17rem' }}>
          <div className="bg-brand-500 px-4 py-2 flex items-center justify-between">
            <span className="font-bold text-sm text-white tracking-wide">SIMULADOR</span>
            <span className="text-xs text-brand-100 font-medium bg-brand-600 px-2 py-0.5 rounded-full">
              etapa: {paymentStage}
            </span>
          </div>

          <div className="p-3 space-y-3">
            {/* IDLE: elegir monto y simular QR */}
            {paymentStage === 'idle' && (
              <div className="space-y-2">
                <label className="block">
                  <span className="text-xs font-medium text-muted">Valor a cobrar</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-black/10 bg-gray-50 px-3 py-2 text-sm font-semibold text-ink"
                    value={simAmount}
                    onChange={(e) => setSimAmount(Number(e.target.value))}
                  >
                    {PRESET_AMOUNTS.map((v) => (
                      <option key={v} value={v}>{money(v)}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted">QR real de prueba</span>
                  <input
                    className="mt-1 w-full rounded-xl border border-black/10 bg-gray-50 px-3 py-2 text-xs font-semibold text-ink"
                    value={simQr}
                    onChange={(e) => setSimQr(e.target.value)}
                    placeholder="Pegue aqui el QR real"
                  />
                </label>
                <button
                  className="w-full rounded-2xl bg-brand-500 px-3 py-2.5 text-sm font-bold text-white"
                  onClick={triggerQRScan}
                  disabled={busy}
                >
                  {busy ? 'Validando...' : 'Simular scan real'}
                </button>
              </div>
            )}

            {/* REVIEW: esperando que el operador acepte */}
            {paymentStage === 'review' && (
              <div className="space-y-2">
                <p className="text-xs text-muted">
                  A cobrar: <strong className="text-ink">{money(amountDue)}</strong>
                </p>
                <p className="text-xs text-muted">
                  Esperando que el usuario toque <em>Pagar</em>...
                </p>
                <button
                  className="w-full rounded-2xl border-2 border-alert-500 px-3 py-2 text-sm font-semibold text-alert-600"
                  onClick={cancelSession}
                  disabled={busy}
                >
                  Cancelar sesion
                </button>
              </div>
            )}

            {/* COLLECTING: insertar billetes y monedas */}
            {paymentStage === 'collecting' && (
              <div className="space-y-2">
                <div className="rounded-2xl bg-gray-50 px-3 py-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted">Insertado</span>
                    <span className="font-semibold text-ink">{money(inserted)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Falta</span>
                    <span className={`font-semibold ${remaining > 0 ? 'text-alert-600' : 'text-ok-600'}`}>
                      {remaining > 0 ? money(remaining) : 'Pagado'}
                    </span>
                  </div>
                </div>
                <p className="text-xs font-medium text-muted">Billetes</p>
                <div className="flex flex-wrap gap-1">
                  {BILLS.map((d) => (
                    <button
                      key={d}
                      className="rounded-xl border border-ok-200 bg-ok-50 px-2 py-1.5 text-xs font-bold text-ok-700"
                      onClick={() => insertCash(d)}
                      disabled={!canAcceptCash || d > remaining}
                    >
                      {money(d)}
                    </button>
                  ))}
                </div>
                <p className="text-xs font-medium text-muted">Monedas</p>
                <div className="flex gap-1">
                  {COINS.map((d) => (
                    <button
                      key={d}
                      className="rounded-xl border border-black/10 bg-gray-100 px-2.5 py-1.5 text-xs font-bold text-muted"
                      onClick={() => insertCash(d)}
                      disabled={!canAcceptCash || d > remaining}
                    >
                      {money(d)}
                    </button>
                  ))}
                </div>
                <button
                  className="w-full rounded-2xl border-2 border-alert-500 px-3 py-2 text-sm font-semibold text-alert-600"
                  onClick={cancelSession}
                  disabled={busy}
                >
                  Cancelar sesion
                </button>
              </div>
            )}

            {error && (
              <div className="rounded-2xl border border-alert-200 bg-alert-50 px-3 py-2 text-xs font-semibold text-alert-600">
                {error}
              </div>
            )}

            {/* FINALIZING */}
            {paymentStage === 'finalizing' && (
              <div className="rounded-2xl bg-ok-50 border border-ok-200 px-3 py-3 text-center">
                <p className="text-sm font-semibold text-ok-700">Pago completado</p>
                <p className="text-xs text-ok-600 mt-1">La pantalla se resetea automaticamente</p>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        className="rounded-full bg-brand-500 px-4 py-2 text-sm font-bold text-white shadow-lg border-2 border-brand-700"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Cerrar SIM' : 'SIM'}
      </button>
    </div>
  );
}
