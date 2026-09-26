# おやこポイント 本番データベースのバックアップ（毎日1回、Windowsのタスクスケジューラから動かす）
# 実装メモ312章。Supabaseは無料プランで自動バックアップが無いため、このパソコンに毎日取る
# （やること5-31、統括決定 2026-09-27「パソコンで取る形でお願いします」）。
#
# 取るもの（どちらもテキストのSQL）:
#   schema.sql … 表・関数・権限などの作り（public スキーマ）
#   data.sql   … 家族のデータ全部（public）と、ログインのアカウント（auth）
# 置き場所: C:\App_cursor\_backup\oyakopoint\<日付>\  … gitの外。家族の個人情報が入るので、
#   GitHub（公開リポジトリ）やクラウドには置かないこと。
# 残す日数: $KeepDays 日分。古いものは自動で消す。
# 合言葉（DBのパスワード）は不要（supabase CLI のログインを使う。db push と同じ仕組み）。
# supabase CLI は途中経過（"Initialising login role..." など）を標準エラーに出す。
# Windows PowerShell 5.1 はそれをエラーと扱うので、止めずに続け、成否は終了コードで判断する。
$ErrorActionPreference = "Continue"
$KeepDays = 14
$AppDir = "C:\App_cursor\oyakopoint-app"
$Root = "C:\App_cursor\_backup\oyakopoint"
$Stamp = Get-Date -Format "yyyy-MM-dd"
$Dir = Join-Path $Root $Stamp
$Log = Join-Path $Root "backup.log"
# PowerShellからは npx が「could not determine executable to run」で動かないため、
# アプリのフォルダに入っている supabase CLI を直接呼ぶ。
$Supabase = Join-Path $AppDir "node_modules\.bin\supabase.cmd"
New-Item -ItemType Directory -Force $Dir | Out-Null
function Write-Log($m) { Add-Content -Path $Log -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) -Encoding utf8 }
try {
  Set-Location $AppDir
  & $Supabase db dump --linked -f (Join-Path $Dir "schema.sql") 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "schema dump failed ($LASTEXITCODE)" }
  & $Supabase db dump --linked --data-only --use-copy -f (Join-Path $Dir "data.sql") 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "data dump failed ($LASTEXITCODE)" }
  $s = (Get-Item (Join-Path $Dir "schema.sql")).Length
  $d = (Get-Item (Join-Path $Dir "data.sql")).Length
  if ($s -lt 10000 -or $d -lt 10000) { throw "dump too small (schema=$s data=$d)" }
  Write-Log "OK $Stamp schema=$s data=$d"
  Get-ChildItem $Root -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' -and $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | ForEach-Object {
    Remove-Item -Recurse -Force $_.FullName
    Write-Log "removed old $($_.Name)"
  }
} catch {
  Write-Log "FAILED $Stamp $($_.Exception.Message)"
  exit 1
}
