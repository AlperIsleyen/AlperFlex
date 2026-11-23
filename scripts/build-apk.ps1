$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
if (-not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { throw 'Android Studio JDK bulunamadı.' }
if (-not (Test-Path (Join-Path $env:ANDROID_HOME 'platforms\android-37.0'))) { throw 'Android SDK platform 37 bulunamadı. LOCAL_SETUP.md adımlarını izleyin.' }

# İmza anahtarı ve DPAPI ile korunan şifresi proje/OneDrive dışında kalır.
$signingDir = Join-Path $env:LOCALAPPDATA 'AlperFlex\signing'
$keyFile = Join-Path $signingDir 'release.p12'
$secretFile = Join-Path $signingDir 'password.dpapi'
$versionFile = Join-Path $signingDir 'version-code.txt'
Add-Type -AssemblyName System.Security
New-Item -ItemType Directory -Path $signingDir -Force | Out-Null
if ((Test-Path -LiteralPath $keyFile) -xor (Test-Path -LiteralPath $secretFile)) {
  throw 'İmza anahtarı veya şifresi eksik. Eski anahtarın yedeğini signing klasörüne geri yükleyin.'
}
if (-not (Test-Path -LiteralPath $keyFile)) {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $password = [BitConverter]::ToString($bytes).Replace('-', '')
  $env:ALPERFLEX_SIGNING_PASSWORD = $password
  & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -noprompt -storetype PKCS12 -keystore $keyFile -alias alperflex -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000 -dname 'CN=AlperFlex Kurye, OU=Local Demo, O=AlperFlex, C=TR' '-storepass:env' ALPERFLEX_SIGNING_PASSWORD '-keypass:env' ALPERFLEX_SIGNING_PASSWORD
  if ($LASTEXITCODE -ne 0) { throw 'Kişisel APK imza anahtarı oluşturulamadı.' }
  $protected = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($password), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllText($secretFile, [Convert]::ToBase64String($protected))
  $password = $null
} else {
  $protected = [Convert]::FromBase64String([IO.File]::ReadAllText($secretFile))
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $env:ALPERFLEX_SIGNING_PASSWORD = [Text.Encoding]::UTF8.GetString($plain)
  [Array]::Clear($plain, 0, $plain.Length)
}
$env:ALPERFLEX_SIGNING_KEYSTORE = $keyFile
$lastVersion = if (Test-Path -LiteralPath $versionFile) { [int](Get-Content -LiteralPath $versionFile -Raw) } else { 1 }
$versionCode = [Math]::Max(2, $lastVersion + 1)
$env:ALPERFLEX_VERSION_CODE = [string]$versionCode

# React Native C++ derlemesi Windows yol sınırına takılır. Yalnızca derleme için
# kısa, fiziksel bir kopya kullanılır; kaynak ve çıktı proje klasöründe kalır.
$stage = @('C:\a', 'C:\b', 'C:\c') | Where-Object { -not (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $stage) { throw 'Boş C:\a, C:\b veya C:\c geçici derleme yolu bulunamadı.' }
$cmakeStage = switch ($stage) { 'C:\a' { 'C:\o' } 'C:\b' { 'C:\p' } 'C:\c' { 'C:\q' } }
if (Test-Path -LiteralPath $cmakeStage) { throw "CMake geçici yolu zaten dolu: $cmakeStage" }
$stageFull = [IO.Path]::GetFullPath($stage)
if ($stageFull -notmatch '^C:\\[abc]$') { throw 'Geçersiz derleme klasörü.' }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$succeeded = $false
try {
  & robocopy (Join-Path $sourceRoot 'apps\mobile') $stage /E /XD node_modules android ios .expo dist /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Proje geçici derleme klasörüne kopyalanamadı ($LASTEXITCODE)." }
  Push-Location $stage
  try {
    & npm install --prefer-online
    if ($LASTEXITCODE -ne 0) { throw 'npm install başarısız.' }
    & npx expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild başarısız.' }
    $manifest = Get-Content -LiteralPath 'android\app\src\main\AndroidManifest.xml' -Raw
    if ($manifest -notmatch 'android:usesCleartextTraffic="true"') { throw 'Yerel HTTP izni Android manifestinde bulunamadı.' }
    $gradleFile = Join-Path (Get-Location) 'android\app\build.gradle'
    $gradleText = [IO.File]::ReadAllText($gradleFile)
    $marker = '    defaultConfig {'
    if (-not $gradleText.Contains($marker)) { throw 'Android Gradle yapılandırması bulunamadı.' }
    $gradleText = $gradleText.Replace($marker, "$marker`n        externalNativeBuild { cmake { arguments '-DCMAKE_OBJECT_PATH_MAX=200' } }")
    if (-not $gradleText.Contains("android {")) { throw 'Android Gradle bloğu bulunamadı.' }
    $cmakeSlash = $cmakeStage.Replace('\', '/')
    $gradleText = $gradleText.Replace('android {', "android {`n    externalNativeBuild { cmake { buildStagingDirectory file('$cmakeSlash') } }")
    $signingMarker = '    signingConfigs {'
    if (-not $gradleText.Contains($signingMarker)) { throw 'Android imza yapılandırması bulunamadı.' }
    $signingBlock = @'
        alperflex {
            storeFile file(System.getenv('ALPERFLEX_SIGNING_KEYSTORE'))
            storePassword System.getenv('ALPERFLEX_SIGNING_PASSWORD')
            keyAlias 'alperflex'
            keyPassword System.getenv('ALPERFLEX_SIGNING_PASSWORD')
        }
'@
    $gradleText = $gradleText.Replace($signingMarker, "$signingMarker`n$signingBlock")
    $buildTypes = $gradleText.IndexOf('    buildTypes {')
    $releaseType = $gradleText.IndexOf('        release {', $buildTypes)
    $releaseSigning = $gradleText.IndexOf('signingConfig signingConfigs.debug', $releaseType)
    if ($buildTypes -lt 0 -or $releaseType -lt 0 -or $releaseSigning -lt 0) { throw 'Android üretim imza satırı bulunamadı.' }
    $gradleText = $gradleText.Remove($releaseSigning, 'signingConfig signingConfigs.debug'.Length).Insert($releaseSigning, 'signingConfig signingConfigs.alperflex')
    [IO.File]::WriteAllText($gradleFile, $gradleText, [Text.UTF8Encoding]::new($false))
    Push-Location 'android'
    try {
      & .\gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a'
      if ($LASTEXITCODE -ne 0) { throw 'Gradle APK derlemesi başarısız.' }
    } finally { Pop-Location }
    $apk = Join-Path (Get-Location) 'android\app\build\outputs\apk\release\app-release.apk'
    if (-not (Test-Path -LiteralPath $apk)) { throw 'Derleme tamamlandı ama APK bulunamadı.' }
    $output = Join-Path $sourceRoot 'dist'
    New-Item -ItemType Directory -Path $output -Force | Out-Null
    $target = Join-Path $output 'AlperFlex-Kurye.apk'
    Copy-Item -LiteralPath $apk -Destination $target -Force
    Set-Content -LiteralPath $versionFile -Value $versionCode -Encoding ASCII
    Write-Output "APK hazır: $target"
    $succeeded = $true
  } finally { Pop-Location }
} finally {
  Remove-Item Env:ALPERFLEX_SIGNING_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:ALPERFLEX_SIGNING_KEYSTORE -ErrorAction SilentlyContinue
  Remove-Item Env:ALPERFLEX_VERSION_CODE -ErrorAction SilentlyContinue
  # Hata olursa yerel derleme önbelleği korunur ve hata ayıklama hızlanır.
  if ($succeeded -and (Test-Path -LiteralPath $stageFull)) { Remove-Item -LiteralPath $stageFull -Recurse -Force -ErrorAction Continue }
  if ($succeeded -and $cmakeStage -match '^C:\\[opq]$' -and (Test-Path -LiteralPath $cmakeStage)) { Remove-Item -LiteralPath $cmakeStage -Recurse -Force -ErrorAction Continue }
  elseif (-not $succeeded) { Write-Output "Derleme klasörü inceleme için korundu: $stageFull" }
}
