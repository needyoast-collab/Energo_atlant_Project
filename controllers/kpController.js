const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { sendNotification } = require('../utils/notifications');
const { sendEmail } = require('../utils/email');
const { ROLES } = require('../utils/constants');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3, BUCKET } = require('../config/storage');
const { exec } = require('child_process');
const util = require('util');
const os = require('os');
const { normalizeUploadFileName } = require('../utils/fileNames');

const execPromise = util.promisify(exec);

function formatKpMoney(value, withCurrency = false) {
  const amount = Number(value || 0);
  const hasKopecks = Math.abs(amount % 1) > 0;
  const formatted = amount.toLocaleString('ru-RU', {
    minimumFractionDigits: hasKopecks ? 2 : 0,
    maximumFractionDigits: hasKopecks ? 2 : 0,
  }).replace(/\u00a0/g, ' ');

  return withCurrency ? `${formatted} ₽` : formatted;
}

function formatKpLineMoney(items, fields) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    const next = { ...item };
    fields.forEach((field) => {
      if (next[field] !== undefined && next[field] !== null && next[field] !== '') {
        next[field] = formatKpMoney(next[field]);
      }
    });
    return next;
  });
}

function prepareKpTemplateData(data) {
  return {
    ...data,
    kpNumber: data.kpNumber || 'б/н',
    finalSum: formatKpMoney(data.finalSum),
    finalSumCurrency: formatKpMoney(data.finalSum, true),
    baseSum: formatKpMoney(data.baseSum),
    worksTotal: formatKpMoney(data.worksTotal),
    materialsTotal: formatKpMoney(data.materialsTotal),
    works: formatKpLineMoney(data.works, ['effective_price', 'total']),
    materials: formatKpLineMoney(data.materials, ['unit_price', 'total']),
  };
}

async function getNextKpNumber(client) {
  const yearResult = await client.query(`SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS year`);
  const year = yearResult.rows[0].year;
  const counter = await client.query(
    `INSERT INTO kp_number_counters (year, last_number)
     VALUES ($1, 1)
     ON CONFLICT (year)
     DO UPDATE
       SET last_number = kp_number_counters.last_number + 1,
           updated_at = NOW()
     RETURNING year, last_number`,
    [year]
  );
  const sequence = counter.rows[0].last_number;

  return {
    year,
    sequence,
    number: `ЭА_${sequence}`,
  };
}

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
         AND m.status <> 'draft'
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
  doc.render(prepareKpTemplateData(data));
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
    return fs.readFileSync(pdfPath);
  } catch (err) {
    console.error('Ошибка конвертации (Убедитесь что LibreOffice установлен):', err.message);
    // В случае ошибки возвращаем null, чтобы хотя бы отправить Word, как резерв.
    return null;
  } finally {
    fs.rmSync(docxPath, { force: true });
    fs.rmSync(pdfPath, { force: true });
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
    err.message = 'Ошибка генерации Word: ' + errorStr;
    err.status = 500;
    return next(err);
  }
}

// Отправка КП заказчику (Кнопка "Отправить")
async function sendKp(req, res, next) {
  const client = await pool.connect();
  let committed = false;
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

    await client.query('BEGIN');
    const kpNumber = await getNextKpNumber(client);
    kpData.kpNumber = kpNumber.number;

    if (req.file) {
      fileBuffer = req.file.buffer;
      const originalName = normalizeUploadFileName(req.file.originalname, `${safeProjectName}.docx`);
      fileName = `КП_${kpNumber.number}_${originalName}`;
      if (fileName.toLowerCase().endsWith('.docx')) {
        const pdfBuffer = await convertWordToPdf(fileBuffer, id);
        if (pdfBuffer) {
          fileBuffer = pdfBuffer;
          fileName = fileName.replace(/\.docx$/i, '.pdf');
        }
      }
    } else {
      const docxBuffer = createWordBuffer(kpData);
      fileName = `КП_${kpNumber.number}_${safeProjectName}.pdf`;

      const pdfBuffer = await convertWordToPdf(docxBuffer, id);
      if (pdfBuffer) {
        fileBuffer = pdfBuffer;
      } else {
        fileBuffer = docxBuffer;
        fileName = `КП_${kpNumber.number}_${safeProjectName}.docx`;
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

    const kpDocument = await client.query(
      `INSERT INTO project_documents
         (project_id, uploaded_by, doc_type, file_key, file_name, description, kp_number, kp_year, kp_sequence)
       VALUES ($1, $2, 'kp', $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        id,
        req.session.userId,
        fileKey,
        fileName,
        `Коммерческое предложение № ${kpNumber.number}`,
        kpNumber.number,
        kpNumber.year,
        kpNumber.sequence,
      ]
    );

    const proj = await client.query(
      `UPDATE projects
       SET status = 'offer', kp_sent_at = CURRENT_DATE
       WHERE id = $1
       RETURNING id, code, name, contact_name, contact_email, partner_id`,
      [id]
    );

    await client.query('COMMIT');
    committed = true;

    if (proj.rows[0].partner_id) {
      await sendNotification({
        userId: proj.rows[0].partner_id,
        projectId: parseInt(id, 10),
        type: 'document',
        entityType: 'document',
        entityId: kpDocument.rows[0].id,
        message: `Вам направлено коммерческое предложение по проекту ${proj.rows[0].code}`,
      });
    }

    const emailTo = proj.rows[0].contact_email;
    if (emailTo) {
      const emailSent = await sendEmail({
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

      if (!emailSent) {
        return res.status(502).json({
          success: false,
          error: 'КП сохранено в документах проекта, но письмо не отправлено. Проверьте SMTP и повторите отправку.',
        });
      }
    }

    return res.json({
      success: true,
      data: {
        kp_number: kpNumber.number,
        kp_year: kpNumber.year,
        kp_sequence: kpNumber.sequence,
      },
      message: `КП № ${kpNumber.number} успешно отправлено`,
    });
  } catch (err) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.warn('[KP] Не удалось откатить транзакцию КП:', rollbackErr.message);
      }
    }
    return next(err);
  } finally {
    client.release();
  }
}

module.exports = { getKpData, generateWord, sendKp };
