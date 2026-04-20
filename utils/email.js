const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.yandex.ru',
  port: process.env.SMTP_PORT || 465, // У Яндекса/Mail 465 порт для SSL
  secure: process.env.SMTP_SECURE !== 'false',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail({ to, subject, html, attachments }) {
  if (!process.env.SMTP_USER) {
    console.warn(`[EMAIL] Ошбика: SMTP не настроен (SMTP_USER пуст). Письмо для ${to} не отправлено.`);
    return false;
  }
  
  try {
    const mailOptions = {
      from: `"ЭнергоАтлант" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      attachments,
    };
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error('[EMAIL] Ошибка при отправке письма:', err);
    return false;
  }
}

module.exports = { sendEmail };
