const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { sendNotification } = require('../utils/notifications');
const { sendEmail } = require('../utils/email');
// Если PizZip и docxtemplater установятся успешно:
// const PizZip = require('pizzip');
// const Docxtemplater = require('docxtemplater');

async function getKpData(req, res, next) {
  try {
    const { id } = req.params;

    // Проверяем проект
    const project = await pool.query(
      `SELECT p.*, u.email as customer_email, u.name as customer_name
       FROM projects p
       LEFT JOIN users u ON u.id = p.partner_id -- если заказчик связан, или contact_email
       WHERE p.id = $1 AND p.is_deleted = FALSE`,
      [id]
    );
    if (!project.rows[0]) {
      return res.status(404).json({ success: false, error: 'Проект не найден' });
    }

    // Достаем ВОР (работы) и мержим с каталогом цен
    const worksResult = await pool.query(`
      SELECT w.id, w.work_name, w.quantity, w.unit,
             COALESCE(pc.base_price, 0) as base_price
      FROM work_specs w
      LEFT JOIN price_catalog pc ON pc.item_name = w.work_name AND pc.item_type = 'work'
      WHERE w.project_id = $1 AND w.is_deleted = FALSE
    `, [id]);

    // Достаем ВОМ (материалы) и мержим
    const materialsResult = await pool.query(`
      SELECT m.id, m.material_name, m.quantity, m.unit,
             COALESCE(pc.base_price, 0) as base_price
      FROM material_specs m
      LEFT JOIN price_catalog pc ON pc.item_name = m.material_name AND pc.item_type = 'material'
      WHERE m.project_id = $1 AND m.is_deleted = FALSE
    `, [id]);

    return res.json({
      success: true,
      data: {
        project: project.rows[0],
        works: worksResult.rows,
        materials: materialsResult.rows
      }
    });

  } catch (err) {
    return next(err);
  }
}

const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');

// Вспомогательная функция сборки буфера Word из JSON
function createWordBuffer(data) {
  const content = fs.readFileSync(path.resolve(__dirname, '../templates/kp_template.docx'), 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const os = require('os');

// Конвертация Word в PDF через локальный LibreOffice
async function convertWordToPdf(wordBuffer, id) {
  const tmpDir = os.tmpdir();
  const fileBaseName = `kp_temp_${id}_${Date.now()}`;
  const docxPath = path.join(tmpDir, `${fileBaseName}.docx`);
  const pdfPath = path.join(tmpDir, `${fileBaseName}.pdf`);

  fs.writeFileSync(docxPath, wordBuffer);

  // На Маке LibreOffice лежит по другому пути, на сервере (Linux) вызывается глобально soffice.
  const cmd = process.platform === 'darwin' 
    ? `/Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to pdf --outdir "${tmpDir}" "${docxPath}"`
    : `soffice --headless --convert-to pdf --outdir "${tmpDir}" "${docxPath}"`;

  try {
    await execPromise(cmd);
    const pdfBuffer = fs.readFileSync(pdfPath);
    fs.unlinkSync(docxPath);
    fs.unlinkSync(pdfPath);
    return pdfBuffer;
  } catch (err) {
    console.error('Ошибка конвертации (Убедитесь что LibreOffice установлен):', err.message);
    // В случае ошибки возвращаем null, чтобы хотя бы отправить Word, как резерв.
    return null;
  }
}

// Выгрузка Word файла (Кнопка "Изменить")
async function generateWord(req, res, next) {
  try {
    const data = req.body;
    const buf = createWordBuffer(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="KP.docx"');
    return res.send(buf);
  } catch(err) {
    console.error('Docxtemplater error:', err);
    let errorStr = err.message;
    if (err.properties && err.properties.errors) {
       errorStr += ' | Детали: ' + err.properties.errors.map(e => e.message).join(', ');
    }
    return res.status(500).json({ error: 'Ошибка генерации Word: ' + errorStr });
  }
}

// Отправка КП заказчику (Кнопка "Отправить")
async function sendKp(req, res, next) {
   try {
    const { id } = req.params;
    let fileBuffer, fileName;

    // Извлекаем данные, нужно чтобы понять название объекта для имени файла
    let safeProjectName = `Проект_${id}`;
    let kpData = {};
    if (req.body.kpData) {
       kpData = JSON.parse(req.body.kpData);
       if (kpData.projectName) {
         safeProjectName = kpData.projectName.replace(/[/\\?%*:|"<>]/g, '_');
       }
    }

    // Пользователь загрузил свой исправленный файл?
    if (req.file) {
      fileBuffer = req.file.buffer;
      fileName = req.file.originalname || `КП_${safeProjectName}.docx`;
      // Если он загрузил PDF, оставляем. Если docx, пытаемся конвертировать.
      if (fileName.endsWith('.docx')) {
        const pdfBuffer = await convertWordToPdf(fileBuffer, id);
        if (pdfBuffer) {
           fileBuffer = pdfBuffer;
           fileName = fileName.replace('.docx', '.pdf');
        }
      }
    } else {
      // Иначе генерируем сами из переданных JSON-данных
      const docxBuffer = createWordBuffer(kpData);
      fileName = `КП_${safeProjectName}.pdf`;
      
      const pdfBuffer = await convertWordToPdf(docxBuffer, id);
      if (pdfBuffer) {
        fileBuffer = pdfBuffer;
        // filename is already set above to КП_${safeProjectName}.pdf
      } else {
        // Резервный механизм
        fileBuffer = docxBuffer;
        fileName = `КП_${safeProjectName}.docx`;
      }
    }
    
    const isDocx = fileName.endsWith('.docx');
    const contentType = isDocx 
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
      : 'application/pdf';

    // 1. Отправляем в Yandex Object Storage
    const fileKey = `projects/${id}/kp_${Date.now()}_${encodeURIComponent(fileName)}`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: contentType,
    }));

    // 2. Регистрируем документ
    await pool.query(
      `INSERT INTO project_documents (project_id, uploaded_by, doc_type, file_key, file_name, description)
       VALUES ($1, $2, 'kp', $3, $4, 'Коммерческое предложение')`,
      [id, req.session.userId, fileKey, fileName]
    );

    // 3. Обновляем статус в воронке (если еще не дальше offer)
    const proj = await pool.query(
      `UPDATE projects SET status = 'offer', kp_sent_at = CURRENT_DATE
       WHERE id = $1 RETURNING *`, 
      [id]
    );

    // 4. Уведомление внутри системы
    if (proj.rows[0].partner_id) { // Если есть контакт/пользователь (в схеме partner_id или contact_email)
       // Упрощенно: Заказчик - это обычно partner_id в старом формате, либо отдельный юзер. 
       // Шлем внутреннее
       await sendNotification({
         userId: proj.rows[0].partner_id, // или ID заказчика
         projectId: id,
         type: 'document',
         message: `Вам направлено коммерческое предложение по проекту ${proj.rows[0].code}`
       });
    }

    // 5. Отправка на Email Заказчика
    const emailTo = proj.rows[0].contact_email; // почта из карточки проекта
    if (emailTo) {
      await sendEmail({
        to: emailTo,
        subject: `Коммерческое предложение по проекту ${proj.rows[0].name}`,
        html: `<p>Здравствуйте, ${proj.rows[0].contact_name || 'уважаемый заказчик'}!</p>
               <p>Направляем вам расчет стоимости (Коммерческое предложение).<br>
               Файл прикреплен во вложении.</p>
               <p>С уважением, ЭнергоАтлант</p>`,
        attachments: [
          { filename: fileName, content: fileBuffer }
        ]
      });
    }

    return res.json({ success: true, message: 'КП успешно отправлено' });
   } catch(err) {
    return next(err);
   }
}

module.exports = { getKpData, generateWord, sendKp };
