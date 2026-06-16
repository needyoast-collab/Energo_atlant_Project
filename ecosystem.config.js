// PM2 конфигурация для боевого сервера ЭнергоАтлант
//
// Запуск:    pm2 start ecosystem.config.js
// Перезапуск: pm2 reload energoatlant
// Логи:      pm2 logs energoatlant
// Автозапуск при ребуте VPS:
//   pm2 startup    (выполнить выведенную команду)
//   pm2 save

module.exports = {
  apps: [
    {
      name: 'energoatlant',
      script: 'server.js',
      cwd: __dirname,

      // Один инстанс: in-memory транспортёр почты и счётчики rate-limit
      // не шарятся между процессами, поэтому cluster здесь не подходит.
      instances: 1,
      exec_mode: 'fork',

      // Перезапуск при падении, но не чаще — защита от краш-лупа
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,

      // Перезапуск если процесс распух (утечки)
      max_memory_restart: '500M',

      // .env читается самим приложением через dotenv,
      // здесь дублируем только NODE_ENV на случай запуска без .env
      env: {
        NODE_ENV: 'production',
      },

      // Логи
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
