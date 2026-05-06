# Starts a separate Chrome instance with remote debugging enabled, in its own
# profile directory so it doesn't conflict with your everyday Chrome. Use this
# Chrome window to sign in to Rippling and navigate to the course, then run
# `npm start` in another terminal to attach the automation.

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$profileDir = "C:\chrome-coursetaker"
$port = 9222

if (-not (Test-Path $chrome)) {
  $chrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chrome)) {
  Write-Error "Couldn't find chrome.exe. Edit start-chrome.ps1 with the right path."
  exit 1
}

Write-Host "Launching Chrome (debug port $port, profile $profileDir)..."
& $chrome `
  "--remote-debugging-port=$port" `
  "--user-data-dir=$profileDir" `
  "--disable-features=IsolateOrigins,site-per-process" `
  "--disable-blink-features=AutomationControlled" `
  "--disable-backgrounding-occluded-windows" `
  "--disable-renderer-backgrounding" `
  "--disable-background-timer-throttling"
