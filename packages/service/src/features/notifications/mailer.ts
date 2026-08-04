import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { ServiceConfig } from "../../infra/config.js";
import { logger } from "../../infra/logger.js";
import type { ScanCompletedPayload } from "./storage.js";
import * as storage from "./storage.js";

let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
let transport: Transporter | null = null;
let publicBaseUrl = "https://openvuln.clouditera.com";

function buildTransport(cfg: ServiceConfig): Transporter | null {
  if (!cfg.notify.emailEnabled) return null;
  if (!cfg.smtp.host || !cfg.smtp.user || !cfg.smtp.password) return null;
  return nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: { user: cfg.smtp.user, pass: cfg.smtp.password },
    pool: true,
    maxConnections: 2,
  });
}

function normalizePayload(raw: unknown): ScanCompletedPayload {
  let p = raw as ScanCompletedPayload | string;
  if (typeof p === "string") {
    try {
      p = JSON.parse(p) as ScanCompletedPayload;
    } catch {
      p = {} as ScanCompletedPayload;
    }
  }
  const counts = p.counts ?? { critical: 0, high: 0, medium: 0, low: 0 };
  return {
    project_id: p.project_id ?? "",
    full_name: p.full_name ?? "unknown",
    owner_login: p.owner_login ?? (p.full_name?.split("/")[0] || "unknown"),
    name: p.name ?? (p.full_name?.split("/")[1] || "unknown"),
    scan_job_id: p.scan_job_id ?? "",
    counts: {
      critical: Number(counts.critical ?? 0),
      high: Number(counts.high ?? 0),
      medium: Number(counts.medium ?? 0),
      low: Number(counts.low ?? 0),
    },
    no_value: Boolean(p.no_value),
  };
}

function renderEmail(raw: ScanCompletedPayload, base: string): { subject: string; text: string } {
  const p = normalizePayload(raw);
  const c = p.counts;
  const total = (c.critical ?? 0) + (c.high ?? 0) + (c.medium ?? 0) + (c.low ?? 0);
  const link = `${base.replace(/\/$/, "")}/p/${p.owner_login}/${p.name}`;

  if (p.no_value || total === 0) {
    return {
      subject: `[OpenVuln] ${p.full_name} scan completed — 0 findings`,
      text: [
        `Project: ${p.full_name}`,
        `Scan finished with no public-severity findings.`,
        `View: ${link}`,
        ``,
        `— OpenVuln`,
      ].join("\n"),
    };
  }
  return {
    subject: `[OpenVuln] ${p.full_name} scan completed — ${total} findings`,
    text: [
      `Project: ${p.full_name}`,
      `Findings: critical ${c.critical ?? 0} / high ${c.high ?? 0} / medium ${c.medium ?? 0} / low ${c.low ?? 0}`,
      `View: ${link}`,
      ``,
      `This email contains summary counts only — no vulnerability details.`,
      `— OpenVuln`,
    ].join("\n"),
  };
}

export async function mailerTick(fromAddr: string): Promise<void> {
  if (!transport) return;
  await storage.markEmailSkippedNoAddress();
  const pending = await storage.listPendingEmail(5);
  for (const row of pending) {
    const { subject, text } = renderEmail(row.payload, publicBaseUrl);
    try {
      await transport.sendMail({
        from: fromAddr,
        to: row.email,
        subject,
        text,
      });
      await storage.markEmailSent(row.id);
      logger.info(
        { notificationId: row.id, to: row.email, project: row.payload.full_name },
        "Notification email sent",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await storage.markEmailFailed(row.id, msg);
      logger.warn(
        { err, notificationId: row.id, attempts: row.email_attempts + 1 },
        "Notification email failed",
      );
    }
  }
}

export function startMailer(config: ServiceConfig): void {
  if (timer) return;
  transport = buildTransport(config);
  publicBaseUrl = config.publicBaseUrl;
  if (!transport) {
    logger.info("Mailer not started (SMTP disabled or incomplete)");
    return;
  }
  const from = config.smtp.from || config.smtp.user;
  logger.info({ host: config.smtp.host, port: config.smtp.port }, "Mailer started");
  const tick = () => {
    if (busy) return;
    busy = true;
    mailerTick(from)
      .catch((err) => logger.error({ err }, "mailer tick failed"))
      .finally(() => {
        busy = false;
      });
  };
  timer = setInterval(tick, 30_000);
  // first pass soon
  setTimeout(tick, 3_000);
}

export function stopMailer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (transport) {
    transport.close();
    transport = null;
  }
}

/** Test helper / admin: force one tick. */
export async function runMailerOnce(config: ServiceConfig): Promise<void> {
  if (!transport) {
    transport = buildTransport(config);
    publicBaseUrl = config.publicBaseUrl;
  }
  if (!transport) return;
  await mailerTick(config.smtp.from || config.smtp.user);
}
