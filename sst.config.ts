/// <reference path="./.sst/platform/config.d.ts" />

import path from "node:path";

export default $config({
  app(input) {
    return {
      name: "invidious",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "cloudflare",
      providers: {
        tailscale: true,
        docker: true,
        cloudflare: true,
      },
    };
  },
  async run() {
    const dbUserSecret = new sst.Secret("DbUser");
    const dbPassSecret = new sst.Secret("DbPass");
    const hmacKey = new sst.Secret("HmacKey");

    const tailnetKey = new tailscale.TailnetKey("tailnetKey", {
      reusable: true,
      ephemeral: true,
      preauthorized: true,
      expiry: 60 * 60 * 24 * 7,
    });

    const tailscaleContainer = new docker.Container("tailscale", {
      name: "tailscale",
      image: "tailscale/tailscale:latest",
      hostname: "hometube",
      restart: "unless-stopped",
      mounts: [
        {
          target: "/dev/net/tun",
          source: "/dev/net/tun",
          type: "bind",
          readOnly: false,
        },
      ],

      volumes: [
        {
          hostPath: path.join(process.cwd(), "./ts-state"),
          containerPath: "/var/lib/tailscale",
        },
        {
          hostPath: path.join(process.cwd(), "./ts-config"),
          containerPath: "/config",
        },
      ],
      capabilities: { adds: ["NET_ADMIN", "SYS_MODULE"] },
      envs: [
        $interpolate`TS_AUTHKEY=${tailnetKey.key}`,
        `TS_EXTRA_ARGS=--advertise-tags=tag:container`,
        `TS_SERVE_CONFIG=/config/serve.json`,
        `TS_STATE_DIR=/var/lib/tailscale`,
      ],
      // entrypoints: [
      //   'sh -c "tailscaled & tailscale up --accept-routes && tailscale serve --bg 3000 && sleep infinity"',
      // ],
    });

    const postgresVolume = new docker.Volume("postgresData", {
      name: "postgresData",
    });
    const network = new docker.Network("invidious-network", {
      name: "invidious-network",
      driver: "bridge",
    });

    const dbContainer = new docker.Container("invidious-db", {
      name: "invidious-db",
      image: "docker.io/library/postgres:14",
      networkMode: $interpolate`service:${tailscaleContainer.name}`,
      networksAdvanced: [
        {
          name: network.name,
        },
      ],
      envs: [
        "POSTGRES_DB=invidious",
        $interpolate`POSTGRES_USER=${dbUserSecret.value}`,
        $interpolate`POSTGRES_PASSWORD=${dbPassSecret.value}`,
      ],
      mounts: [
        {
          target: "/config/sql",
          source: path.join(process.cwd(), "./config/sql"),
          type: "bind",
          readOnly: false,
        },
        {
          target: "/docker-entrypoint-initdb.d/init-invidious-db.sh",
          source: path.join(process.cwd(), "./docker/init-invidious-db.sh"),
          type: "bind",
          readOnly: false,
        },
      ],
      volumes: [
        {
          volumeName: postgresVolume.name,
          containerPath: "/var/lib/postgresql/data",
        },
      ],
      healthcheck: {
        tests: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"],
      },
      restart: "unless-stopped",
    });

    const appContainer = new docker.Container(
      "invidious",
      {
        name: "invidious",
        image: "quay.io/invidious/invidious:latest-arm64",
        networksAdvanced: [
          {
            name: network.name,
          },
        ],
        envs: [
          // Please read the following file for a comprehensive list of all available
          // configuration options and their associated syntax:
          // https://github.com/iv-org/invidious/blob/master/config/config.example.yml
          $interpolate`INVIDIOUS_CONFIG=db:
  dbname: invidious
  user: ${dbUserSecret.value}
  password: ${dbPassSecret.value}
  host: invidious-db
  port: 5432
check_tables: true
# external_port:
# domain:
# https_only: false
# statistics_enabled: false
hmac_key: "${hmacKey.value}"`,
        ],
        ports: [
          {
            external: 3000,
            internal: 3000,
            ip: "127.0.0.1",
          },
        ],
        healthcheck: {
          tests: [
            "wget -nv --tries=1 --spider http://127.0.0.1:3000/api/v1/trending || exit 1",
          ],
          interval: "30s",
          timeout: "5s",
          retries: 2,
        },
        logDriver: "json-file",
        logOpts: {
          "max-size": "1G",
          "max-file": "4",
        },
        restart: "unless-stopped",
      },
      { dependsOn: [dbContainer] },
    );
  },
});
