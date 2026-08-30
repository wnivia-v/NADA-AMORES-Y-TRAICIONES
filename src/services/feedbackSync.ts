// =============================================================================
// Envio de reportes
//
// La cola de feedback lleva existiendo desde que se puso el boton, pero hasta
// ahora no salia de aqui. Este archivo es lo que la vacia, y todo lo que hace
// esta condicionado a que se cumplan TRES cosas a la vez:
//
//   1. mayShareReports() — el usuario encendio el ambito de reportes y su
//      consentimiento sigue vigente. Es la puerta del §4.4 y esta es la unica
//      llamada que la cruza.
//   2. Hay sesion. Sin cuenta no hay a quien atribuir el reporte, y sin eso el
//      corpus no se puede defender de quien lo quiera envenenar.
//   3. Hay red. Si no, la cola espera: no se pierde nada.
//
// Van en ese orden por un motivo: la comprobacion de consentimiento es la
// primera, asi que ninguna de las otras dos puede llegar a mandar nada sin ella.
//
// Se envia de uno en uno y no en lote. Es mas lento y da igual —esto no corre
// en el camino caliente— y a cambio un reporte que el servidor rechaza no
// arrastra a los demas.
// =============================================================================

import { mayShareReports } from './policyService';
import { authHeaders } from './accountService';
import { feedbackService, type QueuedReport } from './feedbackService';
import { proxyBaseUrl, hasProxy } from './aiProviders/proxyClient';

export interface SyncOutcome {
  sent: number;
  /** Rechazados por el servidor. No se reintentan: no van a mejorar. */
  rejected: number;
  /** No se pudieron entregar ahora. Siguen en cola. */
  pending: number;
  /** Por que no se hizo nada, si no se hizo nada. */
  skipped?: 'no-consent' | 'no-session' | 'no-server' | 'nothing-to-send';
}

/**
 * Lo que se manda de un reporte guardado.
 *
 * `status` y `queuedAt` son estado local y no le importan a nadie mas. El
 * servidor genera su propio id: el de aqui identifica la fila local, y dejar
 * que el cliente elija identificadores en el servidor invita a colisiones y a
 * cosas peores.
 */
function wireFormat(report: QueuedReport) {
  const { status: _status, queuedAt: _queuedAt, id: _id, ...rest } = report;
  return rest;
}

export async function syncPendingReports(): Promise<SyncOutcome> {
  const empty: SyncOutcome = { sent: 0, rejected: 0, pending: 0 };

  // La puerta, primero.
  if (!mayShareReports()) return { ...empty, skipped: 'no-consent' };

  const headers = authHeaders();
  if (!headers) return { ...empty, skipped: 'no-session' };
  if (!hasProxy()) return { ...empty, skipped: 'no-server' };

  const pending = await feedbackService.pending();
  if (pending.length === 0) return { ...empty, skipped: 'nothing-to-send' };

  const delivered: string[] = [];
  let rejected = 0;
  let stillPending = 0;

  for (const report of pending) {
    let response: Response | null = null;
    try {
      response = await fetch(`${proxyBaseUrl()}/v1/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(wireFormat(report)),
      });
    } catch {
      // Fallo de red: se queda en cola y se reintenta otro dia.
      stillPending += 1;
      continue;
    }

    if (response.status === 201) {
      delivered.push(report.id);
      continue;
    }

    // 400 es un reporte que el servidor no acepta y no va a aceptar nunca:
    // reintentarlo cada arranque solo gastaria bateria. Se marca como entregado
    // para sacarlo de la cola, y queda guardado localmente por si sirve.
    if (response.status === 400) {
      delivered.push(report.id);
      rejected += 1;
      continue;
    }

    // 401 (sesion caida), 403 (sin verificar), 429 (limite): todos se arreglan
    // solos con el tiempo o con una accion del usuario. Se espera.
    stillPending += 1;
    if (response.status === 401 || response.status === 429) break;
  }

  if (delivered.length > 0) await feedbackService.markSent(delivered);

  return { sent: delivered.length - rejected, rejected, pending: stillPending };
}
