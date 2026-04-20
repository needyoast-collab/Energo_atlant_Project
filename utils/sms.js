// Отправка СМС через SMS.ru (используем встроенный fetch Node.js 18+)
async function sendSms(phone, text) {
  try {
    const apiId = process.env.SMSRU_API_ID;
    if (!apiId) {
      console.log('--- MOCK SMS ---');
      console.log('To:', phone);
      console.log('Text:', text);
      console.log('----------------');
      return true; // В режиме разработки просто выводим в консоль
    }

    // Для Node 18+ можно использовать fetch()
    const url = `https://sms.ru/sms/send?api_id=${apiId}&to=${phone}&msg=${encodeURIComponent(text)}&json=1`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.status_code === 100) {
      return true;
    } else {
      console.error('Ошибка SMS.ru:', data.status_text);
      return false;
    }
  } catch (error) {
    console.error('Сбой отправки SMS:', error.message);
    return false;
  }
}

module.exports = { sendSms };
