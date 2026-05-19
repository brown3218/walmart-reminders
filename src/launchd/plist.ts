export const launchAgentLabel = "com.local.walmart-reminders";

export function renderLaunchAgentPlist(projectDir: string): string {
  const root = projectDir.replace(/\/+$/, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchAgentLabel}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(root)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(`${root}/scripts/run-service.sh`)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(`${root}/var/logs/launchd.out.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(`${root}/var/logs/launchd.err.log`)}</string>
</dict>
</plist>
`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
