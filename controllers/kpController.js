const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { sendNotification } = require('../utils/notifications');
const { sendEmail } = require('../utils/email');
const { ROLES } = require('../middleware/auth');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');
const { exec } = require('child_process');
const util = require('util');
const os = require('os');

const execPromise = util.promisify(exec);

async function getManagerProject(projectId, req) {
  const values = [projectId];
  let where = 'p.id = $1 AND p.is_deleted = FALSE';

  if (req.session.userRole !== ROLES.ADMIN) {
    values.push(req.session.userId);
    where += ' AND p.manager_id = $2';
  }

  const result = await pool.query(
    `SELECT p.id, p.code, p.name, p.address, p.contact_name, p.contact_email,
            p.include_materials, p.regional_coeff, p.partner_id
     FROM projects p
     WHERE ${where}`,
    values
  );

  return result.rows[0] || null;
}

async function getKpData(req, res, next) {
  try {
    const { id } = req.params;
    const project = await getManagerProject(id, req);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Проект не найден или нет доступа' });
    }

    const worksResult = await pool.query(
      `SELECT w.id, w.work_name, w.quantity, w.unit, w.manager_price,
              COALESCE(pc.base_price, 0) AS catalog_price,
              COALESCE(w.manager_price, pc.base_price, 0) AS effective_price
       FROM work_specs w
       LEFT JOIN price_catalog pc
         ON pc.item_name = w.work_name
        AND pc.item_type = 'work'
       WHERE w.project_id = $1
         AND w.is_deleted = FALSE
       ORDER BY w.created_at, w.id`,
      [id]
    );

    const materialsResult = await pool.query(
      `SELECT m.id, m.material_name, m.quantity, m.unit,
              m.unit_price
       FROM material_specs m
       WHERE m.project_id = $1
         AND m.is_deleted = FALSE
       ORDER BY m.created_at, m.id`,
      [id]
    );

    return res.json({
      success: true,
      data: {
        project,
        works: worksResult.rows,
        materials: materialsResult.rows,
      },
    });
  } catch (err) {
    return next(err);
  }
}

// Вспомогательная функция сборки буфера Word из JSON
function createWordBuffer(data) {
  const content = fs.readFileSync(path.resolve(__dirname, '../templates/kp_template.docx'), 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

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
    const project = await getManagerProject(id, req);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Проект не найден или нет доступа' });
    }

    let fileBuffer, fileName;
    let safeProjectName = project.name.replace(/[/\\?%*:|"<>]/g, '_');
    let kpData = {};

    if (req.body.kpData) {
      kpData = JSON.parse(req.body.kpData);
      if (kpData.projectName) {
        safeProjectName = kpData.projectName.replace(/[/\\?%*:|"<>]/g, '_');
      }
    }

    if (req.file) {
      fileBuffer = req.file.buffer;
      fileName = req.file.originalname || `КП_${safeProjectName}.docx`;
      if (fileName.endsWith('.docx')) {
        const pdfBuffer = await convertWordToPdf(fileBuffer, id);
        if (pdfBuffer) {
          fileBuffer = pdfBuffer;
          fileName = fileName.replace('.docx', '.pdf');
        }
      }
    } else {
      const docxBuffer = createWordBuffer(kpData);
      fileName = `КП_${safeProjectName}.pdf`;

      const pdfBuffer = await convertWordToPdf(docxBuffer, id);
      if (pdfBuffer) {
        fileBuffer = pdfBuffer;
      } else {
        fileBuffer = docxBuffer;
        fileName = `КП_${safeProjectName}.docx`;
      }
    }
    
    const isDocx = fileName.endsWith('.docx');
    const contentType = isDocx 
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
      : 'application/pdf';

    const fileKey = `projects/${id}/kp_${Date.now()}_${encodeURIComponent(fileName)}`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileKey,
      Body: fileBuffer,
      ContentType: contentType,
    }));

    await pool.query(
      `INSERT INTO project_documents (project_id, uploaded_by, doc_type, file_key, file_name, description)
       VALUES ($1, $2, 'kp', $3, $4, 'Коммерческое предложение')`,
      [id, req.session.userId, fileKey, fileName]
    );

    const proj = await pool.query(
      `UPDATE projects
       SET status = 'offer', kp_sent_at = CURRENT_DATE
       WHERE id = $1
       RETURNING id, code, name, contact_name, contact_email, partner_id`,
      [id]
    );

    if (proj.rows[0].partner_id) {
      await sendNotification({
        userId: proj.rows[0].partner_id,
        projectId: parseInt(id, 10),
        type: 'document',
        message: `Вам направлено коммерческое предложение по проекту ${proj.rows[0].code}`,
      });
    }

    const emailTo = proj.rows[0].contact_email;
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
  } catch (err) {
    return next(err);
  }
}

module.exports = { getKpData, generateWord, sendKp };
