module.exports = {
  apps: [
    {
      name: 'infocoffee-backend',
      script: './backend/app.js',
      env: {
        NODE_ENV: 'production'
      },
      error_file: '/root/.pm2/logs/infocoffee-backend-error.log',
      out_file: '/root/.pm2/logs/infocoffee-backend-out.log',
      log_file: '/root/.pm2/logs/infocoffee-backend.log',
      time: true,
      instances: 1,
      exec_mode: 'fork'
    },
    {
      name: 'infocoffee-scheduler',
      script: './backend/worker/schedule_imports.js',
      env: {
        NODE_ENV: 'production'
      },
      error_file: '/root/.pm2/logs/infocoffee-scheduler-error.log',
      out_file: '/root/.pm2/logs/infocoffee-scheduler-out.log',
      log_file: '/root/.pm2/logs/infocoffee-scheduler.log',
      time: true,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
} 