module.exports = {
  apps: [
    {
      name: "developer-portal-v2",
      cwd: "/root/developer-portal-v2",
      script: "node_modules/next/dist/bin/next",
      args: "start --hostname 127.0.0.1 --port 18880",
      interpreter: "/opt/node-v24.21.0-linux-x64/bin/node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 10000,
      time: true,
      env: {
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        PATH: "/opt/node-v24.21.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin",
      },
    },
  ],
};
