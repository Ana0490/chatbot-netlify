// netlify/functions/lead-capture.js
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

exports.handler = async (event) => {
  // CORS básico para permitir llamadas desde tu sitio
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const required = ['servicio','detalle','tipoCliente','urgencia','ubicacion','nombre','contacto'];
    const missing = required.filter(k => !body[k]);
    if (missing.length) return json(400, { error: `Faltan campos: ${missing.join(', ')}` });

    // 1) Guardar en Google Sheets
    const sheetResult = await appendToSheet(body);

    // 2) Enviar email de aviso
    const emailResult = await sendEmail(body);

    return json(200, { ok: true, sheet: sheetResult, email: emailResult });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message || 'Error interno' });
  }
};

function json(code, obj) {
  return {
    statusCode: code,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(obj)
  };
}

/** ---------- Google Sheets ---------- */
async function appendToSheet(data) {
  const {
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY,
    SHEET_ID
  } = process.env;

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !SHEET_ID) {
    throw new Error('Faltan variables de entorno de Google Sheets');
  }

  // En Netlify la private key suele venir con \n; esto lo corrige:
  const privateKey = GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

  const jwt = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  const sheets = google.sheets({ version: 'v4', auth: jwt });

  const values = [[
    new Date().toISOString(),
    data.servicio,
    data.detalle,
    data.tipoCliente,
    data.urgencia,
    data.ubicacion,
    data.nombre,
    data.contacto,
    data.origen || ''
  ]];

  const range = `${process.env.SHEET_TAB || 'Leads'}!A:I`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });

  return { appended: true, range };
}

/** ---------- Email (SMTP) ---------- */
async function sendEmail(data) {
  const {
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, EMAIL_TO
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !EMAIL_FROM || !EMAIL_TO) {
    throw new Error('Faltan variables de entorno SMTP/Email');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // true si usás 465
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  const html = `
    <h2>Nuevo lead – Chatbot Estudio Contable</h2>
    <ul>
      <li><b>Servicio:</b> ${escapeHtml(data.servicio)}</li>
      <li><b>Detalle:</b> ${escapeHtml(data.detalle)}</li>
      <li><b>Tipo de cliente:</b> ${escapeHtml(data.tipoCliente)}</li>
      <li><b>Urgencia:</b> ${escapeHtml(data.urgencia)}</li>
      <li><b>Ubicación:</b> ${escapeHtml(data.ubicacion)}</li>
      <li><b>Nombre:</b> ${escapeHtml(data.nombre)}</li>
      <li><b>Contacto:</b> ${escapeHtml(data.contacto)}</li>
      <li><b>Origen:</b> ${escapeHtml(data.origen || '')}</li>
      <li><b>Fecha:</b> ${new Date().toLocaleString()}</li>
    </ul>
  `;

  const info = await transporter.sendMail({
    from: EMAIL_FROM,
    to: EMAIL_TO,
    subject: `Nuevo lead (${data.servicio}) – ${data.nombre}`,
    html
  });

  return { messageId: info.messageId };
}

function escapeHtml(s=''){ return String(s).replace(/[<>&"]/g, m=>({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[m])); }
