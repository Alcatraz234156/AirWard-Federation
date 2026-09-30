# AirWard Federation - Google Cloud Run Deployment Script (PowerShell)
$ErrorActionPreference = "Stop"

Write-Host "🌍 AirWard Federation - Google Cloud Run Deployment" -ForegroundColor Cyan
Write-Host "=================================================="

# Check if gcloud is installed
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: gcloud CLI is not installed or not in PATH." -ForegroundColor Red
    Write-Host "👉 Quickest way: Use Google Cloud Shell in your browser at https://console.cloud.google.com" -ForegroundColor Yellow
    Write-Host "   Alternatively, install the Google Cloud SDK installer from https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    exit 1
}

# Check project ID
$projectId = (gcloud config get-value project 2>$null)
if (-not $projectId -or $projectId -eq "(unset)") {
    $projectId = Read-Host "Enter your Google Cloud Project ID"
    gcloud config set project $projectId
}
Write-Host "📦 Project ID: $projectId" -ForegroundColor Green

# Prompt for Gemini API Key if not set
$geminiKey = $env:GEMINI_API_KEY
if (-not $geminiKey) {
    $geminiKey = Read-Host "Enter your GEMINI_API_KEY (from https://aistudio.google.com)"
}

$region = "us-central1"
$serviceName = "airward"

Write-Host "🚀 Deploying AirWard full-stack container to Cloud Run ($region)..." -ForegroundColor Cyan

Set-Location "$PSScriptRoot\server"

gcloud run deploy $serviceName `
  --source . `
  --region $region `
  --allow-unauthenticated `
  --set-env-vars "GEMINI_API_KEY=$geminiKey,GEMINI_MODEL=gemini-3.8-flash,ALLOWED_ORIGINS=*"

$serviceUrl = (gcloud run services describe $serviceName --region $region --format='value(status.url)')

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "🎉 Deployment successful!" -ForegroundColor Green
Write-Host "🌍 Live AirWard URL: $serviceUrl" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Green
