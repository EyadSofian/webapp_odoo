import { defineRailway, project, service, volume } from "railway/iac";

// Replaces railway.json (Config as Code), which Railway stopped reading on 2026-12-01.
// Railway does not read this file on deploy: `railway config apply` writes these
// settings to the service, and deploys then use them. First applied 2026-11-22.
//
// This repository manages only its own resources in the environment; the Postgres
// service and its volume are left alone. Other repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "app";

export default defineRailway(() => {
  // Chat files and task submissions. Mirrors the volume as it exists in Railway;
  // resize it here (not in the dashboard) or the next apply will undo the change.
  const storage = volume("app-volume", {
    region: "us-west2",
    sizeMB: 50000,
    allowOnlineResize: true,
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
  });

  const app = service("app", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/alive",
    healthcheckTimeout: 120,
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    replicas: { "us-west2": 1 },
    // Leaving this out would detach the volume from the service.
    volumeMounts: { "/app/storage": storage },
  });

  const definition = {
    // Secrets stay in Railway; IaC never reads or writes service variables.
    // Required: without it the CLI treats variables as managed and refuses to plan
    // until every app variable (secrets included) is declared in this file.
    // The CLI reads it, but railway@3.17.0's project() type does not declare it yet,
    // so it is passed through a variable rather than an object literal.
    variables: { managed: false },
    resources: [app],
  };
  return project("engosoft-learn", definition);
});
