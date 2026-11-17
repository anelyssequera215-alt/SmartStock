# Ejecutar desde PowerShell con GitHub CLI instalado y autenticado.
# Crea en bloque los Issues S5 y S6 del repositorio SmartStock.
$ErrorActionPreference = "Stop"
$repo = "anelyssequera215-alt/SmartStock"
$csv = Join-Path $PSScriptRoot "SmartStock_Issues_Entregables_5_y_6.csv"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "No se encontro GitHub CLI. Instalala desde https://cli.github.com/ y vuelve a ejecutar." -ForegroundColor Red
    exit 1
}
gh auth status
if ($LASTEXITCODE -ne 0) {
    Write-Host "Primero ejecuta: gh auth login" -ForegroundColor Yellow
    exit 1
}
if (-not (Test-Path $csv)) {
    Write-Host "No se encontro el CSV junto al script: $csv" -ForegroundColor Red
    exit 1
}

$items = Import-Csv -Path $csv
foreach ($item in $items) {
    $body = @"
**Identificador:** $($item.id)
**Responsable propuesto:** $($item.responsable)
**Prioridad:** $($item.prioridad)
**Estimación:** $($item.story_points) SP · $($item.horas) horas
**Entregable:** $($item.id.Substring(0,2))

$($item.body)

---
Creado mediante carga por lotes del plan de trabajo de SmartStock.
"@
    Write-Host "Creando $($item.id): $($item.title)" -ForegroundColor Cyan
    gh issue create --repo $repo --title "[$($item.id)] $($item.title)" --body $body
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Se detuvo en $($item.id). Revisa el error antes de continuar." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Listo: se crearon los 14 Issues." -ForegroundColor Green
Write-Host "Abre https://github.com/$repo/issues para revisarlos y agregarlos al Project."
