#!/usr/bin/env bash
# AirWard Federation - Google Cloud Run Deployment Script
set -e

echo "🌍 AirWard Federation - Google Cloud Run Deployment"
echo "=================================================="

# Check for gcloud
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed."
    echo "👉 Please run this in Google Cloud Shell (https://console.cloud.google.com) or install Google Cloud SDK."
    exit 1
fi

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
    echo "⚠️ No active GCP project set."
    read -p "Enter your Google Cloud Project ID: " PROJECT_ID
    gcloud config set project "$PROJECT_ID"
fi

echo "📦 Project ID: $PROJECT_ID"

# Prompt for Gemini API Key if not already in env
if [ -z "$GEMINI_API_KEY" ]; then
    read -sp "Enter your GEMINI_API_KEY (from https://aistudio.google.com): " GEMINI_API_KEY
    echo ""
fi

REGION="us-central1"
SERVICE_NAME="airward"

echo "🚀 Deploying AirWard full-stack container to Cloud Run (Region: $REGION)..."
cd "$(dirname "$0")/server"

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=$GEMINI_API_KEY,GEMINI_MODEL=gemini-3.8-flash,ALLOWED_ORIGINS=*"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')

echo ""
echo "=================================================="
echo "🎉 Deployment successful!"
echo "🌍 Live AirWard Application URL: $SERVICE_URL"
echo "=================================================="
