Param(
  [string]$CoreUrl = "https://unpkg.com/@ffmpeg/core@0.11.6/dist/ffmpeg-core.js",
  [string]$Out = "public/ffmpeg-core.js"
)
mkdir public -ErrorAction SilentlyContinue
Write-Host "Downloading $CoreUrl -> $Out"
Invoke-WebRequest -Uri $CoreUrl -OutFile $Out -UseBasicParsing
Write-Host "Downloaded. Size:"
Get-Item public\ffmpeg-core.js | Select-Object Name, @{N='SizeMB';E={$_.Length/1MB}}
