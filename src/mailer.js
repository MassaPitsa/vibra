import nodemailer from 'nodemailer';
import { config } from './config.js';

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export const mailEnabled = () => Boolean(transport);

export async function sendMail({ to, subject, text, html }) {
  if (!transport) {
    // En desarrollo, sin SMTP, el contenido se muestra en consola.
    console.log(`\n[mail:dev] Para: ${to}\nAsunto: ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: config.smtp.from || config.smtp.user, to, subject, text, html });
}
