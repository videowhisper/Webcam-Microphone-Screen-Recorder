/*
 * Optional deployed-demo overrides. Leave apiBasePath empty for automatic
 * same-folder routing: <public demo folder>/api/.
 *
 * Example: window.VW_RECORDER_DEMO_CONFIG = { apiBasePath: "/shared-recorder-api" };
 */
window.VW_RECORDER_DEMO_CONFIG = Object.assign(
  { apiBasePath: "" },
  window.VW_RECORDER_DEMO_CONFIG || {}
);
