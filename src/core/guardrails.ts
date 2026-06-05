/**
 * Guardrails: system prompt construction, identity header, model-output parsing,
 * and best-effort red-line detection (defense-in-depth on top of the prompt).
 */
import type { Config } from '../config.js';

/** Safe reply used when a conversation is escalated to a human. */
export const HOLDING_REPLY =
  'Con gusto. Para darle la mejor información, un asesor de Sigg.la continuará esta conversación con usted muy pronto.';

/** Safe reply used when the daily token budget is exhausted. */
export const BUDGET_REPLY =
  'Gracias por escribirnos. En este momento un asesor le atenderá personalmente y le responderá lo antes posible.';

/** Prepend the bot-identity header to an outbound message. */
export function withHeader(text: string, header: string): string {
  return `${header}\n\n${text}`.trim();
}

/** Build the system prompt from the knowledge base + fixed rules. */
export function buildSystemPrompt(knowledgeBase: string, cfg: Config): string {
  return `Eres "${cfg.bot.alias}", el asistente virtual de Sigg.la que atiende mensajes ENTRANTES por WhatsApp.

# Tu rol
- Respondes preguntas de personas interesadas (prospectos) sobre Sigg.la y sus sistemas.
- Solo respondes a lo que la persona pregunta. NUNCA inicias temas comerciales por tu cuenta.
- Tu objetivo es informar de forma clara y, cuando haya interés real, invitar a registrarse en el Demo.

# Reglas de comunicación (OBLIGATORIAS)
- Español, tratando de USTED, tono semi-formal y profesional (ni rígido ni demasiado informal).
- Mensajes breves y claros (es WhatsApp). No uses encabezados ni firmas; el sistema agrega el encabezado.

# Líneas rojas (NUNCA las cruces)
- NUNCA menciones precios, tarifas, costos ni cifras de dinero.
- NUNCA des fechas de lanzamiento ni de disponibilidad.
- NUNCA prometas nada ni afirmes que algo "ya está listo" si no consta en la base de conocimiento.
- Los conectores SISI y SINST/VIGIA están EN IMPLEMENTACIÓN; no afirmes que ya funcionan.
- Solo hablas de Sigg.la y temas relacionados (PESV, SG-SST, cumplimiento). Cualquier otro tema -> escala.

# Cuándo escalar a un humano (escalate = true)
- La persona pide precios, cotización, fechas, contrato, o algo que cruce una línea roja.
- Muestra intención real de compra o de agendar demo personalizada ("quiero una demo", "agendar", "hablar con un asesor").
- Pregunta algo que NO está en la base de conocimiento o de lo que no estás seguro.
- Cualquier solicitud fuera de tema.
En esos casos NO inventes: marca escalate=true y deja una respuesta breve y amable de transición.

# Base de conocimiento (tu ÚNICA fuente de verdad)
${knowledgeBase}

# Formato de salida (OBLIGATORIO)
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, con esta forma exacta:
{"reply": "<tu respuesta para la persona>", "escalate": <true|false>, "reason": "<motivo breve si escalate=true, si no cadena vacía>"}`;
}

export interface ParsedReply {
  reply: string;
  escalate: boolean;
  reason: string;
}

/**
 * Defensively parse the model's JSON output. If parsing fails, fall back to
 * treating the whole text as the reply (without escalating).
 */
export function parseModelReply(raw: string): ParsedReply {
  const text = raw.trim();
  const jsonText = extractJsonObject(text) ?? text;
  try {
    const obj = JSON.parse(jsonText) as Partial<ParsedReply>;
    if (typeof obj.reply === 'string') {
      return {
        reply: obj.reply.trim(),
        escalate: obj.escalate === true,
        reason: typeof obj.reason === 'string' ? obj.reason : '',
      };
    }
  } catch {
    // fall through
  }
  return { reply: text, escalate: false, reason: '' };
}

/** Pull the first {...} block out of a string (handles models that wrap JSON in prose/fences). */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * Best-effort detection of red-line leaks in an outbound reply. This is a backstop;
 * the primary defense is the system prompt. Conservative patterns to avoid false positives.
 */
export function detectRedLine(reply: string): { violated: boolean; reason?: string } {
  // Currency amounts: "$1.000", "50 COP", "100 pesos", "1.500.000 COP".
  const pricePattern = /(\$\s?\d)|(\d[\d.,]*\s?(cop|pesos))/i;
  if (pricePattern.test(reply)) {
    return { violated: true, reason: 'output mentioned a price/amount' };
  }

  // Concrete calendar dates ("15 de marzo", "marzo de 2026", "en marzo 2026").
  const months =
    'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
  const datePattern = new RegExp(
    `(\\b\\d{1,2}\\s+de\\s+(${months})\\b)|(\\b(${months})\\s+(de\\s+)?20\\d\\d\\b)`,
    'i',
  );
  if (datePattern.test(reply)) {
    return { violated: true, reason: 'output mentioned a concrete date' };
  }

  return { violated: false };
}
