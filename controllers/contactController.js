const nodemailer = require('nodemailer');
const { z } = require('zod');

const contactSchema = z.object({
  name:    z.string().min(1).max(100),
  phone:   z.string().min(1).max(30),
  email:   z.string().email().max(100).optional().or(z.literal('')),
  message: z.string().max(2000).optional(),
});

let transporter = null;

function getTransporter() {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   'smtp.yandex.ru',
      port:   465,
      secure: true,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
  }
  return transporter;
}

// POST /api/contact
async function sendContact(req, res, next) {
  try {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { name, phone, email, message } = parsed.data;

    const tp = getTransporter();
    if (!tp) {
      console.warn('[MAIL] Transporter не настроен, письмо не будет отправлено');
      return res.json({ success: true });
    }

    const lines = [
      `Имя: ${name}`,
      `Телефон: ${phone}`,
      email   ? `Email: ${email}`       : null,
      message ? `Сообщение: ${message}` : null,
    ].filter(Boolean);

    await tp.sendMail({
      from:    `"ЭнергоАтлант сайт" <${process.env.MAIL_USER}>`,
      to:      'energoatlant@yandex.ru',
      subject: 'Новая заявка с сайта',
      text:    lines.join('\n'),
    });

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { sendContact };
