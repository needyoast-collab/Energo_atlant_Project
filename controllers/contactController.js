const { z } = require('zod');
const { sendEmail } = require('../utils/email');

const contactSchema = z.object({
  name:    z.string().min(1).max(100),
  phone:   z.string().min(1).max(30),
  email:   z.string().email().max(100).optional().or(z.literal('')),
  message: z.string().max(2000).optional(),
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// POST /api/contact
async function sendContact(req, res, next) {
  try {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const { name, phone, email, message } = parsed.data;

    const rows = [
      ['Имя', name],
      ['Телефон', phone],
      email   ? ['Email', email]       : null,
      message ? ['Сообщение', message] : null,
    ].filter(Boolean);

    const html = rows
      .map(([label, value]) => `<p><b>${label}:</b> ${escapeHtml(value)}</p>`)
      .join('');

    await sendEmail({
      to: 'energoatlant@yandex.ru',
      subject: 'Новая заявка с сайта',
      html,
    });

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { sendContact };
