$ErrorActionPreference = "Stop"
Write-Host "Iniciando configuracao (Modo Seguro e Limpo)..." -ForegroundColor Cyan

$dirs = "legacy_temp", "src-ui", "src-ui/src", "src-ui/src/assets", "src-ui/src/components", "src-ui/src/hooks", "src-core", "src-core/src", "src-core/src/engines", "src-core/src/parser", "src-core/src/cache", "locales", "shared"
foreach ($d in $dirs) { if (!(Test-Path $d)) { $null = New-Item -ItemType Directory -Path $d } }

Write-Host "Arquivando codigo legado..." -ForegroundColor Yellow
$files = Get-ChildItem -Path "."
foreach ($f in $files) {
    $n = $f.Name
    $isSafe = ($n -ne "legacy_temp") -and ($n -ne ".git") -and ($n -ne "setup_tauri_project.ps1") -and ($n -ne "src-ui") -and ($n -ne "src-core") -and ($n -ne "locales") -and ($n -ne "shared") -and ($n -ne "node_modules")
    if ($isSafe) { Move-Item -Path $f.FullName -Destination "legacy_temp/" -Force }
}

Write-Host "Criando package.json e tsconfig.json..." -ForegroundColor Cyan

$pkg = '{"name": "libro-tradukisto-workspace", "private": true, "workspaces": ["src-ui", "src-core"], "scripts": {"core:build": "npm run build -w src-core", "ui:dev": "npm run dev -w src-ui", "tauri": "tauri"}, "devDependencies": {"@tauri-apps/cli": "^2.1.0", "typescript": "^5.3.3"}}'
Set-Content -Path "package.json" -Value $pkg -Encoding UTF8

$corePkg = '{"name": "src-core", "version": "1.0.0", "private": true, "main": "dist/index.js", "types": "dist/index.d.ts", "scripts": {"build": "tsc"}, "dependencies": {"@google/genai": "^0.1.1", "cheerio": "^1.0.0-rc.12", "axios": "^1.6.7"}}'
Set-Content -Path "src-core/package.json" -Value $corePkg -Encoding UTF8

$coreTs = '{"compilerOptions": {"target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "declaration": true, "outDir": "./dist", "rootDir": "./src", "strict": true, "esModuleInterop": true, "skipLibCheck": true, "forceConsistentCasingInFileNames": true}, "include": ["src/**/*"]}'
Set-Content -Path "src-core/tsconfig.json" -Value $coreTs -Encoding UTF8

Set-Content -Path "src-core/src/index.ts" -Value "// Core Engine Entry Point" -Encoding UTF8

Write-Host "Rodando o Tauri CLI..." -ForegroundColor Cyan
npx tauri init --app-name "libro-tradukisto" --window-title "LibroTradukisto" --dist-dir "../src-ui/dist" --dev-url "http://localhost:5173" --before-dev-command "npm run ui:dev" --before-build-command "npm run core:build; npm run ui:build"

Write-Host "Baixando bibliotecas (isso pode levar um minuto)..." -ForegroundColor Cyan
npm install

Write-Host "Sucesso total! Ambiente TypeScript montado." -ForegroundColor Green